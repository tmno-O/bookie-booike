-- All callers evaluate the same versioned rules and service-night window.
create function public.effective_rule(p_table_id uuid, p_service_date date)
returns table (
  min_notice_minutes integer, max_advance_days integer, open_weekdays smallint[], closed boolean,
  starts_at timestamptz, ends_at timestamptz
)
language sql stable set search_path = public, pg_temp as $$
  select coalesce(tr.min_notice_minutes, zr.min_notice_minutes, vr.min_notice_minutes, 0),
    coalesce(tr.max_advance_days, zr.max_advance_days, vr.max_advance_days, 30),
    coalesce(tr.open_weekdays, zr.open_weekdays, vr.open_weekdays, array[0,1,2,3,4,5,6]::smallint[]),
    coalesce(tr.closed, zr.closed, vr.closed, false),
    (p_service_date + times.starts) at time zone v.timezone,
    (p_service_date + (times.ends <= times.starts)::integer + times.ends) at time zone v.timezone
  from venue_tables t join venues v on v.id = t.venue_id
  left join lateral (
    select * from booking_rules where venue_id = t.venue_id and scope = 'table' and table_id = t.id
    order by version desc limit 1
  ) tr on true
  left join lateral (
    select * from booking_rules where venue_id = t.venue_id and scope = 'zone' and zone_id = t.zone_id
    order by version desc limit 1
  ) zr on true
  left join lateral (
    select * from booking_rules where venue_id = t.venue_id and scope = 'venue'
    order by version desc limit 1
  ) vr on true
  cross join lateral (
    select coalesce(tr.service_start, zr.service_start, vr.service_start, time '18:00') as starts,
      coalesce(tr.service_end, zr.service_end, vr.service_end, time '02:00') as ends
  ) times
  where t.id = p_table_id;
$$;

create function public.booking_candidates(
  p_venue_id uuid, p_service_date date, p_table_id uuid, p_zone_id uuid,
  p_party_size integer, p_service_at timestamptz, p_now timestamptz
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
      when p_now >= r.ends_at or p_now >= b.closes_at then 'BOOKING_CLOSED'
      when p_now < b.opens_at then 'NOT_OPEN_YET'
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

create function public.venue_availability(p_venue_id uuid, p_service_date date)
returns table (
  id uuid, zone_id uuid, zone_name text, name text, capacity integer, price_satang integer,
  available boolean, result_code text, starts_at timestamptz, ends_at timestamptz
)
language sql stable set search_path = public, pg_temp as $$
  select c.id, c.zone_id, c.zone_name, c.name, c.capacity, c.price_satang,
    c.result_code is null, c.result_code, c.starts_at, c.ends_at
  from booking_candidates(p_venue_id, p_service_date, null, null, 1, null, now()) c
  order by c.zone_name, c.name, c.id;
$$;

revoke all on function public.effective_rule(uuid, date) from public, anon, authenticated;
revoke all on function public.booking_candidates(uuid, date, uuid, uuid, integer, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function public.venue_availability(uuid, date) from public, anon, authenticated;
