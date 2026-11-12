alter table public.venue_settings
  add column allocation_mode text not null default 'auto' check (allocation_mode in ('auto', 'manual'));

alter table public.booking_requests
  add column ticket_id uuid unique,
  add column party_bucket text check (party_bucket in ('1-4', '5-8', '9-12', '12+')),
  add column contact_name text,
  add column contact_phone text,
  add foreign key (venue_id, ticket_id) references public.queue_tickets (venue_id, id),
  add check (ticket_id is null or (actor_type = 'customer' and party_bucket is not null and zone_id is not null));

alter table public.bookings
  drop constraint bookings_status_check,
  alter column table_id drop not null,
  add column reference text,
  add column contact_name text,
  add column contact_phone text,
  add column source text check (source in ('liff', 'staff_assisted')),
  add column checked_in_at timestamptz,
  add check (status in ('confirmed', 'pending_allocation', 'checked_in', 'cancelled')),
  add check (status <> 'pending_allocation' or table_id is null),
  add check (status not in ('confirmed', 'checked_in') or table_id is not null),
  add check (status <> 'checked_in' or checked_in_at is not null);

create table public.booking_reference_counters (
  venue_id uuid not null references public.venues(id) on delete cascade,
  service_year integer not null,
  sequence bigint not null,
  primary key (venue_id, service_year)
);
alter table public.booking_reference_counters enable row level security;
revoke all on public.booking_reference_counters from anon, authenticated;

create function public.booking_reference(p_year integer, p_number bigint)
returns text
language sql immutable set search_path = public, pg_temp as $$
  select 'BL-' || lpad(p_year::text, 4, '0') || '-' || lpad(p_number::text, greatest(4, length(p_number::text)), '0');
$$;

with numbered as (
  select b.id, b.venue_id, extract(year from b.service_date)::int as service_year,
    row_number() over (partition by b.venue_id, extract(year from b.service_date) order by b.created_at, b.id) as seq
  from bookings b
)
update bookings b set reference = booking_reference(n.service_year, n.seq),
  source = r.source, contact_name = c.display_name
from numbered n join booking_requests r on r.venue_id = n.venue_id
join venue_customers c on c.venue_id = r.venue_id and c.customer_id = r.customer_id
where b.id = n.id and r.id = b.request_id;

insert into booking_reference_counters (venue_id, service_year, sequence)
select venue_id, extract(year from service_date)::int, count(*) from bookings group by 1, 2;

alter table public.bookings
  alter column reference set not null,
  alter column contact_name set not null,
  alter column source set not null,
  add unique (venue_id, reference);

create function public.assign_booking_reference()
returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  service_year integer := extract(year from new.service_date)::int;
  next_number bigint;
begin
  insert into booking_reference_counters (venue_id, service_year, sequence)
  values (new.venue_id, service_year, 1)
  on conflict on constraint booking_reference_counters_pkey
  do update set sequence = booking_reference_counters.sequence + 1
  returning sequence into next_number;
  new.reference := booking_reference(service_year, next_number);
  return new;
end
$$;
create trigger bookings_assign_reference before insert on public.bookings
  for each row execute function public.assign_booking_reference();

drop index public.bookings_zone_active;
create index bookings_zone_active on public.bookings (venue_id, service_date, zone_id)
  where status in ('confirmed', 'checked_in');

create or replace function public.has_booking_capacity(
  p_venue_id uuid, p_service_date date, p_table_id uuid, p_zone_id uuid,
  p_zone_capacity integer, p_party_size integer
) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select not exists (
    select 1 from booking_allocations a where a.table_id = p_table_id and a.service_date = p_service_date and a.active
  ) and p_zone_capacity >= p_party_size + (
    select coalesce(sum(b.party_size), 0) from bookings b where b.venue_id = p_venue_id
      and b.service_date = p_service_date and b.zone_id = p_zone_id and b.status in ('confirmed', 'checked_in')
  );
$$;

create or replace function public.process_booking_request(p_request_id uuid)
returns public.booking_requests
language plpgsql set search_path = public, pg_temp as $$
declare
  req booking_requests;
  candidate record;
  selection_mode text;
  allocation text;
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
  select v.table_selection_mode, coalesce(s.allocation_mode, 'auto')
  into selection_mode, allocation
  from venues v left join venue_settings s on s.venue_id = v.id where v.id = req.venue_id;
  if req.party_bucket is null and (selection_mode = 'customer_picks') <> (req.table_id is not null) then
    return reject_booking_request(req.id, 'SELECTION_MODE_CHANGED');
  end if;

  if req.party_bucket is not null then
    if exists (select 1 from zones where venue_id = req.venue_id and id = req.zone_id and status = 'closed') then
      return reject_booking_request(req.id, 'ZONE_CLOSED');
    end if;
    if allocation = 'manual' then booking_state := 'pending_allocation'; end if;
  end if;

  decision_time := clock_timestamp();
  select c.* into candidate
  from booking_candidates(req.venue_id, req.service_date, req.table_id, req.zone_id, req.party_size, req.service_at, decision_time) c
  where c.result_code is null
    and (booking_state = 'pending_allocation'
      or has_booking_capacity(req.venue_id, req.service_date, c.id, c.zone_id, c.zone_capacity, req.party_size))
  order by c.capacity, c.id
  limit 1;

  if not found then
    select case when count(*) filter (where c.result_code is null or c.result_code = 'TABLE_UNAVAILABLE') > 0
        then 'TABLE_UNAVAILABLE' else min(c.result_code) end into reason
    from booking_candidates(req.venue_id, req.service_date, req.table_id, req.zone_id, req.party_size, req.service_at, decision_time) c;
    if req.party_bucket is not null then
      reason := case coalesce(reason, 'TABLE_UNAVAILABLE')
        when 'TABLE_UNAVAILABLE' then 'ZONE_FULL'
        when 'NOT_OPEN_YET' then 'NIGHT_NOT_OPEN'
        else reason end;
    end if;
    return reject_booking_request(req.id, coalesce(reason, 'TABLE_UNAVAILABLE'));
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
  insert into audit_logs (venue_id, actor_type, actor_id, action, entity_id)
    values (req.venue_id, req.actor_type, req.actor_id, 'booking.' || booking_state, new_booking_id);
  update booking_requests set status = 'confirmed', booking_id = new_booking_id, decided_at = decision_time
    where id = req.id returning * into req;
  return req;
end
$$;

revoke all on function public.booking_reference(integer, bigint) from public, anon, authenticated;
revoke all on function public.assign_booking_reference() from public, anon, authenticated;
