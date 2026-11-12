alter table public.venues
  add column phone text not null default '',
  add column address text not null default '',
  add column entry_policy text not null default '';

create table public.venue_settings (
  venue_id uuid primary key references public.venues(id) on delete cascade,
  release_days_before integer not null default 365 check (release_days_before between 0 and 365),
  release_time time not null default '00:00'
);
alter table public.venue_settings enable row level security;
revoke all on public.venue_settings from anon, authenticated;

create function public.opens_at_for(p_venue_id uuid, p_service_date date)
returns timestamptz
language sql stable set search_path = public, pg_temp as $$
  select coalesce(
    (select opens_at from booking_releases where venue_id = p_venue_id and service_date = p_service_date),
    ((p_service_date - coalesce(s.release_days_before, 365)) + coalesce(s.release_time, time '00:00'))
      at time zone 'Asia/Bangkok'
  )
  from venues v left join venue_settings s on s.venue_id = v.id
  where v.id = p_venue_id;
$$;

create function public.queue_opening(p_venue_id uuid)
returns table (today date, max_advance_days integer, opens_at timestamptz)
language sql stable set search_path = public, pg_temp as $$
  with booking_window as (
    select (now() at time zone 'Asia/Bangkok')::date as today,
      coalesce((
        select max_advance_days from booking_rules
        where venue_id = p_venue_id and scope = 'venue'
        order by version desc limit 1
      ), 30) as max_days
  )
  select w.today, w.max_days, min(opens_at_for(p_venue_id, w.today + n))
  from booking_window w cross join lateral generate_series(0, w.max_days) as n
  group by w.today, w.max_days;
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
  select t.id, z.id, z.name, t.name, t.capacity, t.price_satang, z.capacity, r.starts_at, r.ends_at,
    target.service_at,
    case
      when t.status <> 'active' or z.status <> 'active' then 'TABLE_UNAVAILABLE'
      when r.closed or not extract(dow from p_service_date)::smallint = any(r.open_weekdays) then 'CLOSED'
      when p_service_date > (p_now at time zone v.timezone)::date + r.max_advance_days then 'TOO_FAR_AHEAD'
      when p_now >= r.ends_at or p_now >= b.closes_at then 'BOOKING_CLOSED'
      when p_now < opens_at_for(p_venue_id, p_service_date) then 'NOT_OPEN_YET'
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

revoke all on function public.opens_at_for(uuid, date) from public, anon, authenticated;
revoke all on function public.queue_opening(uuid) from public, anon, authenticated;
