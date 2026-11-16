-- Fixes from the 15 November review: large parties, after-midnight check-in, closures that affect
-- bookings, announcement fan-out outside the venue lock, batched LINE delivery, and signed audit checkpoints.

-- 1. Large parties ("12+") follow an owner setting and may span several tables in one zone.
alter table public.venue_settings
  add column large_party_mode text not null default 'staff_review' check (large_party_mode in ('staff_review', 'disabled'));

alter table public.booking_allocations
  drop constraint booking_allocations_pkey,
  drop constraint booking_allocations_venue_id_booking_id_table_id_service_d_fkey,
  add primary key (booking_id, table_id),
  add foreign key (venue_id, booking_id) references public.bookings (venue_id, id),
  add foreign key (venue_id, table_id) references public.venue_tables (venue_id, id);

-- The removed composite key also pinned the allocation night to the booking night; keep that guarantee.
create function public.check_allocation_night() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from bookings where venue_id = new.venue_id and id = new.booking_id and service_date = new.service_date) then
    raise exception 'ALLOCATION_NIGHT_MISMATCH';
  end if;
  return new;
end
$$;
create trigger booking_allocations_night before insert or update on public.booking_allocations
  for each row execute function public.check_allocation_night();

-- Null when the zone can seat the party across its free tables; otherwise the rejection code.
create function public.zone_fits_party(
  p_venue_id uuid, p_service_date date, p_zone_id uuid, p_party_size integer, p_now timestamptz, p_skip_release boolean
) returns text
language sql stable set search_path = public, pg_temp as $$
  with c as (
    select c.*, c.result_code is null and not exists (
        select 1 from booking_allocations a where a.table_id = c.id and a.service_date = p_service_date and a.active
      ) as free
    from booking_candidates_for(p_venue_id, p_service_date, null, p_zone_id, 1, null, p_now, p_skip_release) c
  )
  select case
    when count(*) = 0 then 'ZONE_FULL'
    when count(*) filter (where result_code is null) = 0 then min(result_code)
    when coalesce(sum(capacity) filter (where free), 0) < p_party_size then 'ZONE_FULL'
    when max(zone_capacity) < p_party_size + (
      select coalesce(sum(b.party_size), 0) from bookings b where b.venue_id = p_venue_id
        and b.service_date = p_service_date and b.zone_id = p_zone_id and b.status in ('confirmed', 'checked_in')
    ) then 'ZONE_FULL'
  end
  from c;
$$;

-- Fewest free tables (largest first) that together seat the party, or null when none do.
create function public.tables_for_party(
  p_venue_id uuid, p_service_date date, p_zone_id uuid, p_party_size integer, p_service_at timestamptz
) returns uuid[]
language plpgsql stable set search_path = public, pg_temp as $$
declare picked uuid[] := '{}'; seats integer := 0; t record;
begin
  for t in
    select c.id, c.capacity from booking_candidates_for(p_venue_id, p_service_date, null, p_zone_id, 1, p_service_at, clock_timestamp(), true) c
    where c.result_code is null and not exists (
      select 1 from booking_allocations a where a.table_id = c.id and a.service_date = p_service_date and a.active
    )
    order by c.capacity desc, c.id
  loop
    picked := picked || t.id; seats := seats + t.capacity;
    exit when seats >= p_party_size;
  end loop;
  return case when seats >= p_party_size then picked end;
end
$$;

create or replace function public.process_booking_request(p_request_id uuid)
returns public.booking_requests
language plpgsql set search_path = public, pg_temp as $$
declare
  req booking_requests;
  candidate record;
  selection_mode text;
  allocation text;
  large_mode text;
  skip_release boolean;
  large boolean;
  booking_state text := 'confirmed';
  reason text;
  new_booking_id uuid;
  decision_time timestamptz;
begin
  select * into req from booking_requests where id = p_request_id for update;
  if not found or req.status in ('confirmed', 'rejected') then return req; end if;

  -- Share the venue lock with config mutations, and serialize allocation per service night.
  perform pg_advisory_xact_lock_shared(hashtextextended(req.venue_id::text, 2));
  perform pg_advisory_xact_lock(hashtextextended(req.venue_id::text || ':' || (req.service_date - date '2000-01-01')::text, 3));
  select v.table_selection_mode, coalesce(s.allocation_mode, 'auto'), coalesce(s.large_party_mode, 'staff_review')
  into selection_mode, allocation, large_mode
  from venues v left join venue_settings s on s.venue_id = v.id where v.id = req.venue_id;
  if req.party_bucket is null and (selection_mode = 'customer_picks') <> (req.table_id is not null) then
    return reject_booking_request(req.id, 'SELECTION_MODE_CHANGED');
  end if;

  large := req.party_bucket = '12+';
  if req.party_bucket is not null then
    if exists (select 1 from zones where venue_id = req.venue_id and id = req.zone_id and status = 'closed') then
      return reject_booking_request(req.id, 'ZONE_CLOSED');
    end if;
    if large and large_mode = 'disabled' then return reject_booking_request(req.id, 'LARGE_PARTY_DISABLED'); end if;
    -- Large parties may need several tables, so staff always confirm them.
    if allocation = 'manual' or large then booking_state := 'pending_allocation'; end if;
  end if;

  skip_release := req.source = 'staff_assisted' and req.party_bucket is not null;
  decision_time := clock_timestamp();

  if large then
    reason := zone_fits_party(req.venue_id, req.service_date, req.zone_id, req.party_size, decision_time, skip_release);
    if reason is not null then
      return reject_booking_request(req.id, case reason when 'TABLE_UNAVAILABLE' then 'ZONE_FULL' when 'NOT_OPEN_YET' then 'NIGHT_NOT_OPEN' else reason end);
    end if;
    select c.* into candidate
    from booking_candidates_for(req.venue_id, req.service_date, null, req.zone_id, 1, req.service_at, decision_time, skip_release) c
    where c.result_code is null order by c.capacity desc, c.id limit 1;
  else
    select c.* into candidate
    from booking_candidates_for(
      req.venue_id, req.service_date, req.table_id, req.zone_id, req.party_size, req.service_at, decision_time, skip_release
    ) c
    where c.result_code is null
      and (booking_state = 'pending_allocation'
        or has_booking_capacity(req.venue_id, req.service_date, c.id, c.zone_id, c.zone_capacity, req.party_size))
    order by c.capacity, c.id
    limit 1;

    if not found then
      select case when count(*) filter (where c.result_code is null or c.result_code = 'TABLE_UNAVAILABLE') > 0
          then 'TABLE_UNAVAILABLE' else min(c.result_code) end into reason
      from booking_candidates_for(
        req.venue_id, req.service_date, req.table_id, req.zone_id, req.party_size, req.service_at, decision_time, skip_release
      ) c;
      if req.party_bucket is not null then
        reason := case coalesce(reason, 'TABLE_UNAVAILABLE')
          when 'TABLE_UNAVAILABLE' then 'ZONE_FULL'
          when 'NOT_OPEN_YET' then 'NIGHT_NOT_OPEN'
          else reason end;
      end if;
      return reject_booking_request(req.id, coalesce(reason, 'TABLE_UNAVAILABLE'));
    end if;
  end if;

  insert into bookings (
    venue_id, request_id, customer_id, table_id, zone_id, service_date, service_at, party_size,
    status, source, contact_name, contact_phone
  )
  values (
    req.venue_id, req.id, req.customer_id, case when booking_state = 'confirmed' then candidate.id end,
    candidate.zone_id, req.service_date, candidate.service_at, req.party_size,
    booking_state, req.source,
    coalesce(req.contact_name, (select display_name from venue_customers where venue_id = req.venue_id and customer_id = req.customer_id)),
    req.contact_phone
  ) returning id into new_booking_id;
  if booking_state = 'confirmed' then
    insert into booking_allocations (venue_id, booking_id, table_id, service_date)
      values (req.venue_id, new_booking_id, candidate.id, req.service_date);
    insert into booking_events (venue_id, booking_id, kind, actor_type, actor_id)
      values (req.venue_id, new_booking_id, 'confirmed', req.actor_type, req.actor_id);
    insert into notification_outbox (venue_id, booking_id, kind)
      values (req.venue_id, new_booking_id, 'confirmed');
  end if;
  update booking_requests set status = 'confirmed', booking_id = new_booking_id, decided_at = decision_time
    where id = req.id returning * into req;
  insert into audit_logs (venue_id, actor_type, actor_id, action, entity_id, details)
    values (req.venue_id, req.actor_type, req.actor_id, 'booking.' || booking_state, new_booking_id,
      booking_request_evidence(req, upper(booking_state), case when booking_state = 'confirmed' then candidate.id end, candidate.zone_id));
  return req;
end
$$;

create or replace function public.allocate_booking(p_venue_id uuid, p_booking_id uuid, p_staff_id uuid, p_zone_id uuid)
returns text
language plpgsql set search_path = public, pg_temp as $$
declare
  target bookings;
  requested_at timestamptz;
  chosen_zone zones;
  candidate record;
  picked uuid[];
begin
  perform 1 from venue_members where venue_id = p_venue_id and user_id = p_staff_id for share;
  if not found then return 'NOT_FOUND'; end if;

  select * into target from bookings where venue_id = p_venue_id and id = p_booking_id;
  if not found then return 'NOT_FOUND'; end if;

  perform pg_advisory_xact_lock_shared(hashtextextended(p_venue_id::text, 2));
  perform pg_advisory_xact_lock(hashtextextended(
    p_venue_id::text || ':' || (target.service_date - date '2000-01-01')::text, 3
  ));
  select * into target from bookings where venue_id = p_venue_id and id = p_booking_id for update;
  if not found then return 'NOT_FOUND'; end if;
  if target.status <> 'pending_allocation' then return 'ALREADY_ALLOCATED'; end if;

  select * into chosen_zone from zones where venue_id = p_venue_id and id = coalesce(p_zone_id, target.zone_id);
  if not found then return 'ZONE_NOT_FOUND'; end if;
  if chosen_zone.status = 'closed' then return 'ZONE_CLOSED'; end if;

  select service_at into requested_at from booking_requests where venue_id = p_venue_id and id = target.request_id;
  select c.id, c.zone_id, c.service_at into candidate
  from booking_candidates_for(
    p_venue_id, target.service_date, null, chosen_zone.id, target.party_size, requested_at, clock_timestamp(), true
  ) c
  where c.result_code is null
    and has_booking_capacity(p_venue_id, target.service_date, c.id, c.zone_id, c.zone_capacity, target.party_size)
  order by c.capacity, c.id limit 1;

  if found then
    picked := array[candidate.id];
  else
    -- No single table seats the party: join the fewest free tables of the zone.
    if zone_fits_party(p_venue_id, target.service_date, chosen_zone.id, target.party_size, clock_timestamp(), true) is not null then
      return 'ZONE_FULL';
    end if;
    picked := tables_for_party(p_venue_id, target.service_date, chosen_zone.id, target.party_size, requested_at);
    if picked is null then return 'ZONE_FULL'; end if;
    select c.id, c.zone_id, c.service_at into candidate
    from booking_candidates_for(p_venue_id, target.service_date, picked[1], chosen_zone.id, 1, requested_at, clock_timestamp(), true) c;
  end if;

  update bookings set table_id = candidate.id, zone_id = candidate.zone_id,
    service_at = candidate.service_at, status = 'confirmed' where id = target.id;
  insert into booking_allocations (venue_id, booking_id, table_id, service_date)
    select p_venue_id, target.id, t, target.service_date from unnest(picked) t;
  insert into booking_events (venue_id, booking_id, kind, actor_type, actor_id)
    values (p_venue_id, target.id, 'confirmed', 'staff', p_staff_id);
  insert into notification_outbox (venue_id, booking_id, kind) values (p_venue_id, target.id, 'confirmed');
  insert into audit_logs (venue_id, actor_type, actor_id, action, entity_id, details)
    values (p_venue_id, 'staff', p_staff_id, 'booking.allocated', target.id,
      jsonb_build_object('requestedZoneId', target.zone_id, 'zoneId', candidate.zone_id, 'table_ids', to_jsonb(picked),
        'service_date', target.service_date, 'party_size', target.party_size));
  return 'ALLOCATED';
end
$$;

-- 2. Check-in stays open from the start of the service date until the service night ends (after midnight).
create function public.check_in_open(p_table_id uuid, p_service_date date, p_at timestamptz)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select p_at >= (p_service_date::timestamp at time zone 'Asia/Bangkok')
    and p_at < greatest(
      coalesce((select r.ends_at from effective_rule(p_table_id, p_service_date) r), '-infinity'::timestamptz),
      ((p_service_date + 1)::timestamp at time zone 'Asia/Bangkok'))
$$;

create or replace function public.check_in_booking(p_venue_id uuid, p_booking_id uuid, p_staff_id uuid)
returns text
language plpgsql set search_path = public, pg_temp as $$
declare
  booking_row bookings;
  checked_at timestamptz;
begin
  perform 1 from venue_members where venue_id = p_venue_id and user_id = p_staff_id for share;
  if not found then return 'NOT_FOUND'; end if;

  select * into booking_row from bookings where venue_id = p_venue_id and id = p_booking_id;
  if not found then return 'NOT_FOUND'; end if;

  perform pg_advisory_xact_lock_shared(hashtextextended(p_venue_id::text, 2));
  perform pg_advisory_xact_lock(hashtextextended(
    p_venue_id::text || ':' || (booking_row.service_date - date '2000-01-01')::text, 3
  ));
  select * into booking_row from bookings where venue_id = p_venue_id and id = p_booking_id for update;
  if not found then return 'NOT_FOUND'; end if;
  if booking_row.status = 'checked_in' then return 'ALREADY_CHECKED_IN'; end if;

  checked_at := clock_timestamp();
  if not check_in_open(booking_row.table_id, booking_row.service_date, checked_at) then
    return 'NOT_SERVICE_DATE';
  end if;
  if booking_row.status <> 'confirmed' then return 'BOOKING_NOT_CONFIRMED'; end if;

  update bookings set status = 'checked_in', checked_in_at = checked_at where id = p_booking_id;
  insert into booking_events (venue_id, booking_id, kind, actor_type, actor_id)
    values (p_venue_id, p_booking_id, 'checked_in', 'staff', p_staff_id);
  insert into audit_logs (venue_id, actor_type, actor_id, action, entity_id, details)
    values (p_venue_id, 'staff', p_staff_id, 'booking.checked_in', p_booking_id,
      jsonb_build_object('checked_in_at', checked_at, 'service_date', booking_row.service_date));
  return 'CHECKED_IN';
end
$$;

-- 3. Cancellation notices may carry a reason, such as an owner closing the night.
alter table public.notification_outbox add column note text check (length(note) <= 300);

-- 4. Announcements: the venue lock only covers the announcement row; the audience is added in batches later.
alter table public.release_announcements
  add column fanout_cursor uuid,
  add column fanout_done boolean not null default false;
update public.release_announcements set fanout_done = true;

create or replace function public.announce_release(p_venue_id uuid, p_date date, p_title text, p_opens_at timestamptz, p_staff_id uuid)
returns uuid language plpgsql set search_path = public, pg_temp as $$
declare announcement uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_venue_id::text, 2));
  if not service_night_open(p_venue_id, p_date) then raise exception 'CLOSED'; end if;
  if not exists (select 1 from booking_releases where venue_id = p_venue_id and service_date = p_date and opens_at = p_opens_at) then
    raise exception 'RELEASE_NOT_FOUND';
  end if;
  insert into release_announcements (venue_id, service_date, title, opens_at, created_by)
    values (p_venue_id, p_date, p_title, p_opens_at, p_staff_id)
    on conflict (venue_id, service_date, opens_at, title) do nothing returning id into announcement;
  if announcement is null then
    select id into announcement from release_announcements
      where venue_id = p_venue_id and service_date = p_date and opens_at = p_opens_at and title = p_title;
  end if;
  return announcement;
end
$$;

-- Adds the next batch of past bookers to the outbox. Returns true when the whole audience is queued.
create function public.fanout_announcement(p_announcement_id uuid, p_batch integer default 1000)
returns boolean language plpgsql set search_path = public, pg_temp as $$
declare a release_announcements; picked integer; last_customer uuid;
begin
  select * into a from release_announcements where id = p_announcement_id for update;
  if not found or a.fanout_done then return true; end if;
  with batch as (
    select c.customer_id from venue_customers c
    where c.venue_id = a.venue_id and not c.announcements_opt_out
      and (a.fanout_cursor is null or c.customer_id > a.fanout_cursor)
      and exists (select 1 from bookings b where b.venue_id = c.venue_id and b.customer_id = c.customer_id)
    order by c.customer_id limit p_batch
  ), inserted as (
    insert into announcement_outbox (announcement_id, venue_id, customer_id)
      select a.id, a.venue_id, customer_id from batch
      on conflict (announcement_id, customer_id) do nothing
  )
  select count(*), max(customer_id::text)::uuid into picked, last_customer from batch;
  update release_announcements set fanout_cursor = coalesce(last_customer, fanout_cursor),
    fanout_done = picked < p_batch where id = a.id;
  return picked < p_batch;
end
$$;

-- 5. Batched LINE multicast: rows are leased to a batch whose id doubles as the LINE retry key.
alter table public.announcement_outbox
  drop constraint announcement_outbox_status_check,
  add constraint announcement_outbox_status_check check (status in ('pending', 'sending', 'sent', 'skipped', 'dead')),
  add column batch_id uuid,
  add column lease_until timestamptz;
create index announcement_outbox_batch on public.announcement_outbox (batch_id) where batch_id is not null;
create index announcement_outbox_leased on public.announcement_outbox (lease_until) where status = 'sending';

-- 6. Signed checkpoints anchor the audit chain with a key held outside the database.
create table public.audit_checkpoints (
  venue_id uuid not null references public.venues(id),
  seq bigint not null,
  head_hash bytea not null,
  signed_at timestamptz not null,
  key_id text not null,
  signature text not null,
  primary key (venue_id, seq)
);
create trigger audit_checkpoints_immutable before update or delete on public.audit_checkpoints
  for each row execute function public.reject_audit_mutation();
create trigger audit_checkpoints_no_truncate before truncate on public.audit_checkpoints
  for each statement execute function public.reject_audit_mutation();
alter table public.audit_checkpoints enable row level security;
revoke all on public.audit_checkpoints from public, anon, authenticated;

-- Hygiene: the public API roles never need these sequences.
revoke all on sequence public.booking_events_id_seq, public.audit_logs_id_seq,
  public.queue_tickets_seq_seq, public.booking_requests_queue_seq_seq from anon, authenticated;

revoke all on function public.check_allocation_night(), public.zone_fits_party(uuid, date, uuid, integer, timestamptz, boolean),
  public.tables_for_party(uuid, date, uuid, integer, timestamptz), public.check_in_open(uuid, date, timestamptz),
  public.fanout_announcement(uuid, integer) from public, anon, authenticated;
