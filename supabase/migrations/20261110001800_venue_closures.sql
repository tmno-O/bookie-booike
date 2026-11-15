create table public.venue_closures (
  venue_id uuid not null references public.venues(id),
  service_date date not null,
  reason text not null default '' check (length(reason) <= 300),
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (venue_id, service_date)
);
alter table public.venue_closures enable row level security;
revoke all on public.venue_closures from public, anon, authenticated;

-- Store-level closure always takes precedence over zone/table overrides.
create function public.service_night_open(p_venue_id uuid, p_service_date date)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select not coalesce(r.closed, false)
    and extract(dow from p_service_date)::smallint = any(coalesce(r.open_weekdays, array[0,1,2,3,4,5,6]::smallint[]))
    and not exists (select 1 from venue_closures c where c.venue_id = p_venue_id and c.service_date = p_service_date)
  from venues v left join lateral (
    select closed, open_weekdays from booking_rules where venue_id = v.id and scope = 'venue' order by version desc limit 1
  ) r on true where v.id = p_venue_id;
$$;
revoke all on function public.service_night_open(uuid, date) from public, anon, authenticated;

create or replace function public.booking_candidates_for(
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
      when not service_night_open(p_venue_id, p_service_date) then 'CLOSED'
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

create or replace function public.queue_opening(p_venue_id uuid)
returns table (today date, max_advance_days integer, opens_at timestamptz)
language sql stable set search_path = public, pg_temp as $$
  with booking_window as (
    select (now() at time zone 'Asia/Bangkok')::date as today,
      coalesce((select max_advance_days from booking_rules where venue_id = p_venue_id and scope = 'venue'
        order by version desc limit 1), 30) as max_days
  )
  select w.today, w.max_days,
    min(opens_at_for(p_venue_id, w.today + n)) filter (where service_night_open(p_venue_id, w.today + n))
  from booking_window w cross join lateral generate_series(0, w.max_days) n
  group by w.today, w.max_days;
$$;
