alter table public.booking_requests add column queue_no bigint;

create table public.booking_queue_counters (
  venue_id uuid not null references public.venues(id) on delete cascade,
  service_date date not null,
  sequence bigint not null,
  primary key (venue_id, service_date)
);
alter table public.booking_queue_counters enable row level security;
revoke all on public.booking_queue_counters from anon, authenticated;

with numbered as (
  select id, row_number() over (partition by venue_id, service_date order by created_at, id) as n
  from booking_requests where party_bucket is not null
)
update booking_requests r set queue_no = n.n from numbered n where r.id = n.id;
insert into booking_queue_counters (venue_id, service_date, sequence)
select venue_id, service_date, max(queue_no) from booking_requests where queue_no is not null group by 1, 2;

alter table public.booking_requests
  add check ((party_bucket is null) = (queue_no is null)),
  add check (queue_no > 0);
create unique index booking_requests_queue_order
  on public.booking_requests (venue_id, service_date, queue_no) where queue_no is not null;

create function public.assign_booking_queue_no()
returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  insert into booking_queue_counters (venue_id, service_date, sequence)
  values (new.venue_id, new.service_date, 1)
  on conflict (venue_id, service_date) do update set sequence = booking_queue_counters.sequence + 1
  returning sequence into new.queue_no;
  return new;
end
$$;
create trigger booking_requests_assign_queue_no before insert on public.booking_requests
  for each row when (new.party_bucket is not null) execute function public.assign_booking_queue_no();

create function public.allocate_booking(p_venue_id uuid, p_booking_id uuid, p_staff_id uuid, p_zone_id uuid)
returns text
language plpgsql set search_path = public, pg_temp as $$
declare
  target bookings;
  requested_at timestamptz;
  chosen_zone zones;
  candidate record;
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
  if not found then return 'ZONE_FULL'; end if;

  update bookings set table_id = candidate.id, zone_id = candidate.zone_id,
    service_at = candidate.service_at, status = 'confirmed' where id = target.id;
  insert into booking_allocations (venue_id, booking_id, table_id, service_date)
    values (p_venue_id, target.id, candidate.id, target.service_date);
  insert into booking_events (venue_id, booking_id, kind, actor_type, actor_id)
    values (p_venue_id, target.id, 'confirmed', 'staff', p_staff_id);
  insert into notification_outbox (venue_id, booking_id, kind) values (p_venue_id, target.id, 'confirmed');
  insert into audit_logs (venue_id, actor_type, actor_id, action, entity_id, details)
    values (p_venue_id, 'staff', p_staff_id, 'booking.allocated', target.id,
      jsonb_build_object('requestedZoneId', target.zone_id, 'zoneId', candidate.zone_id));
  return 'ALLOCATED';
end
$$;

revoke all on function public.assign_booking_queue_no() from public, anon, authenticated;
revoke all on function public.allocate_booking(uuid, uuid, uuid, uuid) from public, anon, authenticated;
