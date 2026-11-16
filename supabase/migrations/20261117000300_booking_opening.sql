-- Preserve stored special instants. Calculate all new standard release times in the venue's timezone.
create or replace function public.opens_at_for(p_venue_id uuid, p_service_date date)
returns timestamptz
language sql stable set search_path = public, pg_temp as $$
  select coalesce(
    (select opens_at from booking_releases where venue_id = p_venue_id and service_date = p_service_date),
    ((p_service_date - coalesce(s.release_days_before, 365)) + coalesce(s.release_time, time '00:00')) at time zone v.timezone
  )
  from venues v left join venue_settings s on s.venue_id = v.id
  where v.id = p_venue_id;
$$;
