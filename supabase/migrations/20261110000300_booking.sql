create table public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null,
  customer_id uuid not null,
  actor_type text not null check (actor_type in ('customer', 'staff')),
  actor_id uuid not null,
  source text not null check (source in ('liff', 'staff_assisted')),
  service_date date not null,
  service_at timestamptz,
  party_size integer not null check (party_size > 0),
  phone_last_four text check (phone_last_four ~ '^[0-9]{4}$'),
  table_id uuid,
  zone_id uuid,
  idempotency_key text not null,
  payload_hash text not null,
  status text not null default 'pending_publish' check (status in ('pending_publish', 'queued', 'confirmed', 'rejected')),
  result_code text,
  booking_id uuid,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  decided_at timestamptz,
  check ((table_id is null) <> (zone_id is null)),
  check ((actor_type = 'customer' and actor_id = customer_id and source = 'liff')
    or (actor_type = 'staff' and source = 'staff_assisted')),
  check ((status = 'confirmed') = (booking_id is not null)),
  check ((status = 'rejected') = (result_code is not null)),
  foreign key (venue_id, customer_id) references public.venue_customers,
  foreign key (venue_id, table_id) references public.venue_tables (venue_id, id),
  foreign key (venue_id, zone_id) references public.zones (venue_id, id),
  unique (venue_id, id),
  unique (venue_id, actor_type, actor_id, idempotency_key)
);
create index booking_requests_unpublished on public.booking_requests (created_at) where status = 'pending_publish';

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null,
  request_id uuid not null,
  customer_id uuid not null,
  table_id uuid not null,
  zone_id uuid not null,
  service_date date not null,
  service_at timestamptz not null,
  party_size integer not null check (party_size > 0),
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  check ((status = 'cancelled') = (cancelled_at is not null)),
  foreign key (venue_id, request_id) references public.booking_requests (venue_id, id),
  foreign key (venue_id, customer_id) references public.venue_customers,
  foreign key (venue_id, table_id) references public.venue_tables (venue_id, id),
  foreign key (venue_id, zone_id) references public.zones (venue_id, id),
  unique (venue_id, id),
  unique (venue_id, request_id),
  unique (venue_id, id, table_id, service_date)
);
create index bookings_customer_recent on public.bookings (venue_id, customer_id, created_at desc);
create index bookings_venue_recent on public.bookings (venue_id, created_at desc);
create index bookings_zone_active on public.bookings (venue_id, service_date, zone_id) where status = 'confirmed';

alter table public.booking_requests add constraint booking_requests_booking_fk
  foreign key (venue_id, booking_id) references public.bookings (venue_id, id);

create table public.booking_allocations (
  booking_id uuid primary key,
  venue_id uuid not null,
  table_id uuid not null,
  service_date date not null,
  active boolean not null default true,
  foreign key (venue_id, booking_id, table_id, service_date)
    references public.bookings (venue_id, id, table_id, service_date)
);
create unique index booking_allocations_active on public.booking_allocations (table_id, service_date) where active;

create table public.booking_events (
  id bigint generated always as identity primary key,
  venue_id uuid not null,
  booking_id uuid not null,
  kind text not null check (kind in ('confirmed', 'cancelled')),
  actor_type text not null check (actor_type in ('customer', 'staff')),
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (venue_id, booking_id) references public.bookings (venue_id, id),
  unique (booking_id, kind)
);

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null,
  booking_id uuid not null,
  kind text not null check (kind in ('confirmed', 'cancelled')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'dead')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  foreign key (venue_id, booking_id) references public.bookings (venue_id, id),
  unique (booking_id, kind)
);
create index notification_outbox_pending on public.notification_outbox (next_attempt_at) where status = 'pending';

do $$
declare relation text;
begin
  foreach relation in array array[
    'booking_requests', 'bookings', 'booking_allocations', 'booking_events', 'notification_outbox'
  ] loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('revoke all on public.%I from anon, authenticated', relation);
  end loop;
end
$$;

create function public.has_booking_capacity(
  p_venue_id uuid, p_service_date date, p_table_id uuid, p_zone_id uuid,
  p_zone_capacity integer, p_party_size integer
) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select not exists (
    select 1 from booking_allocations a where a.table_id = p_table_id and a.service_date = p_service_date and a.active
  ) and p_zone_capacity >= p_party_size + (
    select coalesce(sum(b.party_size), 0) from bookings b where b.venue_id = p_venue_id
      and b.service_date = p_service_date and b.zone_id = p_zone_id and b.status = 'confirmed'
  );
$$;

create or replace function public.venue_availability(p_venue_id uuid, p_service_date date)
returns table (
  id uuid, zone_id uuid, zone_name text, name text, capacity integer, price_satang integer,
  available boolean, result_code text, starts_at timestamptz, ends_at timestamptz
)
language sql stable set search_path = public, pg_temp as $$
  select c.id, c.zone_id, c.zone_name, c.name, c.capacity, c.price_satang,
    state.code is null, state.code, c.starts_at, c.ends_at
  from booking_candidates(p_venue_id, p_service_date, null, null, 1, null, now()) c
  cross join lateral (
    select coalesce(c.result_code, case when not has_booking_capacity(
      p_venue_id, p_service_date, c.id, c.zone_id, c.zone_capacity, 1
    ) then 'TABLE_UNAVAILABLE' end) as code
  ) state
  order by c.zone_name, c.name, c.id;
$$;

create function public.reject_booking_request(p_request_id uuid, p_reason text)
returns public.booking_requests
language plpgsql set search_path = public, pg_temp as $$
declare
  req booking_requests;
begin
  select * into req from booking_requests where id = p_request_id for update;
  if not found or req.status in ('confirmed', 'rejected') then return req; end if;

  update booking_requests set status = 'rejected', result_code = p_reason, decided_at = clock_timestamp()
    where id = req.id returning * into req;
  insert into audit_logs (venue_id, actor_type, action, entity_id, details)
    values (req.venue_id, 'system', 'booking.rejected', req.id, jsonb_build_object('code', p_reason));
  return req;
end
$$;

create function public.process_booking_request(p_request_id uuid)
returns public.booking_requests
language plpgsql set search_path = public, pg_temp as $$
declare
  req booking_requests;
  candidate record;
  selection_mode text;
  reason text;
  new_booking_id uuid;
  decision_time timestamptz;
begin
  select * into req from booking_requests where id = p_request_id for update;
  if not found or req.status in ('confirmed', 'rejected') then return req; end if;

  -- Share the venue lock with config mutations, and serialize allocation per service night.
  perform pg_advisory_xact_lock_shared(hashtextextended(req.venue_id::text, 2));
  perform pg_advisory_xact_lock(hashtextextended(req.venue_id::text || ':' || (req.service_date - date '2000-01-01')::text, 3));
  select table_selection_mode into selection_mode from venues where id = req.venue_id;
  if (selection_mode = 'customer_picks') <> (req.table_id is not null) then
    return reject_booking_request(req.id, 'SELECTION_MODE_CHANGED');
  end if;

  decision_time := clock_timestamp();
  select c.* into candidate
  from booking_candidates(req.venue_id, req.service_date, req.table_id, req.zone_id, req.party_size, req.service_at, decision_time) c
  where c.result_code is null
    and has_booking_capacity(req.venue_id, req.service_date, c.id, c.zone_id, c.zone_capacity, req.party_size)
  order by c.capacity, c.id
  limit 1;

  if not found then
    select case when count(*) filter (where c.result_code is null or c.result_code = 'TABLE_UNAVAILABLE') > 0
        then 'TABLE_UNAVAILABLE' else min(c.result_code) end into reason
    from booking_candidates(req.venue_id, req.service_date, req.table_id, req.zone_id, req.party_size, req.service_at, decision_time) c;
    return reject_booking_request(req.id, coalesce(reason, 'TABLE_UNAVAILABLE'));
  end if;

  insert into bookings (venue_id, request_id, customer_id, table_id, zone_id, service_date, service_at, party_size)
    values (req.venue_id, req.id, req.customer_id, candidate.id, candidate.zone_id, req.service_date, candidate.service_at, req.party_size)
    returning id into new_booking_id;
  insert into booking_allocations (venue_id, booking_id, table_id, service_date)
    values (req.venue_id, new_booking_id, candidate.id, req.service_date);
  insert into booking_events (venue_id, booking_id, kind, actor_type, actor_id)
    values (req.venue_id, new_booking_id, 'confirmed', req.actor_type, req.actor_id);
  insert into notification_outbox (venue_id, booking_id, kind)
    values (req.venue_id, new_booking_id, 'confirmed');
  insert into audit_logs (venue_id, actor_type, actor_id, action, entity_id)
    values (req.venue_id, req.actor_type, req.actor_id, 'booking.confirmed', new_booking_id);
  update booking_requests set status = 'confirmed', booking_id = new_booking_id, decided_at = decision_time
    where id = req.id returning * into req;
  return req;
end
$$;

revoke all on function public.has_booking_capacity(uuid, date, uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.process_booking_request(uuid) from public, anon, authenticated;
revoke all on function public.reject_booking_request(uuid, text) from public, anon, authenticated;
