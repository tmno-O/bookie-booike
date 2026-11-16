-- The FCFS flow no longer issues customer tickets. Retain their rows and foreign keys for history.
create function public.booking_window(p_venue_id uuid, p_at timestamptz default statement_timestamp())
returns table (today date, max_advance_days integer)
language sql stable set search_path = public, pg_temp as $$
  select (p_at at time zone v.timezone)::date, coalesce(r.max_advance_days, 30)
  from venues v left join lateral (
    select max_advance_days from booking_rules where venue_id = v.id and scope = 'venue'
    order by version desc limit 1
  ) r on true where v.id = p_venue_id;
$$;

create function public.booking_window_issue(p_venue_id uuid, p_date date, p_at timestamptz)
returns text language sql stable set search_path = public, pg_temp as $$
  select case
    when p_date not between w.today and w.today + w.max_advance_days then 'DATE_OUT_OF_RANGE'
    when not service_night_open(p_venue_id, p_date) then 'CLOSED'
    when r.closes_at <= p_at then 'BOOKING_CLOSED'
    when opens_at_for(p_venue_id, p_date) > p_at then 'NIGHT_NOT_OPEN'
  end
  from booking_window(p_venue_id, p_at) w
  left join booking_releases r on r.venue_id = p_venue_id and r.service_date = p_date;
$$;

create or replace function public.booking_housekeeping()
returns void language plpgsql set search_path = public, pg_temp as $$
begin
  delete from booking_rate_limits where window_start < now() - interval '1 hour';
  delete from customer_sessions where expires_at < now();
  delete from staff_sessions where expires_at < now();
end
$$;

create or replace function public.booking_request_evidence(r public.booking_requests, p_code text, p_table uuid, p_zone uuid)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('request_id', r.id, 'booking_id', r.booking_id,
    'reference', (select reference from bookings where venue_id = r.venue_id and id = r.booking_id),
    'queue_seq', r.queue_seq::text, 'received_at', r.received_at, 'decided_at', r.decided_at,
    'result_code', p_code, 'table_id', p_table, 'zone_id', p_zone, 'service_date', r.service_date,
    'actor', jsonb_build_object('type', r.actor_type, 'id', r.actor_id));
$$;

drop trigger queue_tickets_audit on public.queue_tickets;
revoke all on function public.booking_window(uuid, timestamptz),
  public.booking_window_issue(uuid, date, timestamptz) from public, anon, authenticated;
