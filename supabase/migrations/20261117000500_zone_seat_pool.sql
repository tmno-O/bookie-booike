-- Party-bucket bookings (1-4, 5-8, 9-12) share the zone's seats. Groups keep booking a zone until its seats
-- run out; a table no longer holds a whole group. The booking still names one active table of the zone,
-- which carries the night's service rules (service window, check-in window).
-- Table bookings (no party bucket) and 12+ groups that staff seat across tables keep their table allocations.

create function public.zone_seats_left(p_venue_id uuid, p_service_date date, p_zone_id uuid)
returns integer language sql stable set search_path = public, pg_temp as $$
  select z.capacity - coalesce((
    select sum(b.party_size) from bookings b where b.venue_id = z.venue_id and b.service_date = p_service_date
      and b.zone_id = z.id and b.status in ('confirmed', 'checked_in')
  ), 0)::integer
  from zones z where z.venue_id = p_venue_id and z.id = p_zone_id;
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
  if req.source = 'liff' then
    perform pg_advisory_xact_lock(hashtextextended(req.venue_id::text || ':' || req.customer_id::text, 6));
    if exists (select 1 from customer_active_booking(req.venue_id, req.customer_id)) then
      return reject_booking_request(req.id, 'ACTIVE_BOOKING_EXISTS');
    end if;
  end if;
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

  if req.source = 'liff' then
    reason := booking_window_issue(req.venue_id, req.service_date, decision_time);
    if reason is not null then return reject_booking_request(req.id, reason); end if;
  end if;

  if large then
    reason := zone_fits_party(req.venue_id, req.service_date, req.zone_id, req.party_size, decision_time, skip_release);
    if reason is not null then
      return reject_booking_request(req.id, case reason when 'TABLE_UNAVAILABLE' then 'ZONE_FULL' when 'NOT_OPEN_YET' then 'NIGHT_NOT_OPEN' else reason end);
    end if;
    select c.* into candidate
    from booking_candidates_for(req.venue_id, req.service_date, null, req.zone_id, 1, req.service_at, decision_time, skip_release) c
    where c.result_code is null order by c.capacity desc, c.id limit 1;
  elsif req.party_bucket is not null then
    -- Any open table of the zone carries the night's rules; the zone's free seats decide the booking.
    select c.* into candidate
    from booking_candidates_for(req.venue_id, req.service_date, null, req.zone_id, 1, req.service_at, decision_time, skip_release) c
    where c.result_code is null order by c.capacity desc, c.id limit 1;

    if not found then
      -- A night rule (closed, not open yet, ...) explains the refusal better than an inactive table.
      select min(c.result_code) filter (where c.result_code <> 'TABLE_UNAVAILABLE') into reason
      from booking_candidates_for(req.venue_id, req.service_date, null, req.zone_id, 1, req.service_at, decision_time, skip_release) c;
      return reject_booking_request(req.id, case coalesce(reason, 'ZONE_FULL')
        when 'NOT_OPEN_YET' then 'NIGHT_NOT_OPEN' else coalesce(reason, 'ZONE_FULL') end);
    end if;
    -- Pending requests hold no seats; staff check the seats again when they allocate.
    if booking_state = 'confirmed' and zone_seats_left(req.venue_id, req.service_date, req.zone_id) < req.party_size then
      return reject_booking_request(req.id, 'ZONE_FULL');
    end if;
  else
    select c.* into candidate
    from booking_candidates_for(
      req.venue_id, req.service_date, req.table_id, req.zone_id, req.party_size, req.service_at, decision_time, skip_release
    ) c
    where c.result_code is null
      and has_booking_capacity(req.venue_id, req.service_date, c.id, c.zone_id, c.zone_capacity, req.party_size)
    order by c.capacity, c.id
    limit 1;

    if not found then
      select case when count(*) filter (where c.result_code is null or c.result_code = 'TABLE_UNAVAILABLE') > 0
          then 'TABLE_UNAVAILABLE' else min(c.result_code) end into reason
      from booking_candidates_for(
        req.venue_id, req.service_date, req.table_id, req.zone_id, req.party_size, req.service_at, decision_time, skip_release
      ) c;
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
    -- Only a booking of a specific table holds that table for the night.
    if req.party_bucket is null then
      insert into booking_allocations (venue_id, booking_id, table_id, service_date)
        values (req.venue_id, new_booking_id, candidate.id, req.service_date);
    end if;
    insert into booking_events (venue_id, booking_id, kind, actor_type, actor_id)
      values (req.venue_id, new_booking_id, 'confirmed', req.actor_type, req.actor_id);
    insert into notification_outbox (venue_id, booking_id, kind)
      values (req.venue_id, new_booking_id, 'confirmed');
  elsif req.source = 'liff' and req.ticket_id is null then
    -- Legacy ticket clients still using the previous worker do not enqueue the new message kind.
    insert into notification_outbox (venue_id, booking_id, kind)
      values (req.venue_id, new_booking_id, 'received');
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
  picked uuid[] := '{}';
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

  if target.party_size <= 12 then
    -- Party buckets take seats from the zone, as automatic decisions do.
    if zone_seats_left(p_venue_id, target.service_date, chosen_zone.id) < target.party_size then return 'ZONE_FULL'; end if;
    select c.id, c.zone_id, c.service_at into candidate
    from booking_candidates_for(p_venue_id, target.service_date, null, chosen_zone.id, 1, requested_at, clock_timestamp(), true) c
    where c.result_code is null order by c.capacity desc, c.id limit 1;
    if not found then return 'ZONE_FULL'; end if;
  else
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

-- Earlier party-bucket bookings held a whole table. Release those holds so all bookings follow the seat rule;
-- their seats still count through the bookings themselves.
update public.booking_allocations a set active = false
from public.bookings b join public.booking_requests r on r.venue_id = b.venue_id and r.id = b.request_id
where a.booking_id = b.id and a.active and r.party_bucket in ('1-4', '5-8', '9-12');

revoke all on function public.zone_seats_left(uuid, date, uuid) from public, anon, authenticated;
