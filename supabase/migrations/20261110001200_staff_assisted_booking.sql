alter table public.venue_customers
  add column staff_contact_phone text check (staff_contact_phone ~ '^0[0-9]{8,9}$'),
  add unique (venue_id, staff_contact_phone);

create function public.booking_candidates_for(
  p_venue_id uuid, p_service_date date, p_table_id uuid, p_zone_id uuid,
  p_party_size integer, p_service_at timestamptz, p_now timestamptz, p_skip_release boolean
)
returns table (
  id uuid, zone_id uuid, zone_name text, name text, capacity integer, price_satang integer,
  zone_capacity integer, starts_at timestamptz, ends_at timestamptz, service_at timestamptz,
  result_code text
)
language sql stable set search_path = public, pg_temp as $$
  select t.id, z.id, z.name, t.name, t.capacity, t.price_satang, z.capacity, r.starts_at, r.ends_at,
    target.service_at,
    case
      when t.status <> 'active' or z.status <> 'active' then 'TABLE_UNAVAILABLE'
      when r.closed or not extract(dow from p_service_date)::smallint = any(r.open_weekdays) then 'CLOSED'
      when p_service_date > (p_now at time zone v.timezone)::date + r.max_advance_days then 'TOO_FAR_AHEAD'
      when p_now >= r.ends_at or (not p_skip_release and p_now >= b.closes_at) then 'BOOKING_CLOSED'
      when not p_skip_release and p_now < opens_at_for(p_venue_id, p_service_date) then 'NOT_OPEN_YET'
      when target.service_at < r.starts_at or target.service_at >= r.ends_at then 'OUTSIDE_SERVICE_WINDOW'
      when target.service_at < earliest.notice_at then 'MIN_NOTICE'
      when p_party_size > least(t.capacity, z.capacity) then 'TABLE_UNAVAILABLE'
      else null
    end
  from venue_tables t join venues v on v.id = t.venue_id
  join zones z on z.venue_id = t.venue_id and z.id = t.zone_id
  cross join lateral effective_rule(t.id, p_service_date) r
  left join booking_releases b on b.venue_id = t.venue_id and b.service_date = p_service_date
  cross join lateral (select p_now + make_interval(mins => r.min_notice_minutes) as notice_at) earliest
  cross join lateral (select coalesce(p_service_at, greatest(r.starts_at, earliest.notice_at)) as service_at) target
  where t.venue_id = p_venue_id and (p_table_id is null or t.id = p_table_id)
    and (p_zone_id is null or z.id = p_zone_id);
$$;

create or replace function public.booking_candidates(
  p_venue_id uuid, p_service_date date, p_table_id uuid, p_zone_id uuid,
  p_party_size integer, p_service_at timestamptz, p_now timestamptz
)
returns table (
  id uuid, zone_id uuid, zone_name text, name text, capacity integer, price_satang integer,
  zone_capacity integer, starts_at timestamptz, ends_at timestamptz, service_at timestamptz,
  result_code text
)
language sql stable set search_path = public, pg_temp as $$
  select * from booking_candidates_for(
    p_venue_id, p_service_date, p_table_id, p_zone_id, p_party_size, p_service_at, p_now, false
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
  skip_release boolean;
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

  skip_release := req.source = 'staff_assisted' and req.party_bucket is not null;
  decision_time := clock_timestamp();
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

revoke all on function public.booking_candidates_for(uuid, date, uuid, uuid, integer, timestamptz, timestamptz, boolean)
  from public, anon, authenticated;
