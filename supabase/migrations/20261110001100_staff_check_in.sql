alter table public.booking_events
  drop constraint booking_events_kind_check,
  add check (kind in ('confirmed', 'cancelled', 'checked_in'));

create function public.check_in_booking(p_venue_id uuid, p_booking_id uuid, p_staff_id uuid)
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
  if booking_row.service_date <> (checked_at at time zone 'Asia/Bangkok')::date then
    return 'NOT_SERVICE_DATE';
  end if;
  if booking_row.status <> 'confirmed' then return 'BOOKING_NOT_CONFIRMED'; end if;

  update bookings set status = 'checked_in', checked_in_at = checked_at where id = p_booking_id;
  insert into booking_events (venue_id, booking_id, kind, actor_type, actor_id)
    values (p_venue_id, p_booking_id, 'checked_in', 'staff', p_staff_id);
  insert into audit_logs (venue_id, actor_type, actor_id, action, entity_id)
    values (p_venue_id, 'staff', p_staff_id, 'booking.checked_in', p_booking_id);
  return 'CHECKED_IN';
end
$$;
revoke all on function public.check_in_booking(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.cancel_booking(
  p_venue_id uuid, p_booking_id uuid, p_actor_type text, p_actor_id uuid
) returns text
language plpgsql set search_path = public, pg_temp as $$
declare
  booking_row bookings;
  cutoff integer;
  cancelled_time timestamptz;
begin
  if p_actor_type = 'staff' then
    perform 1 from venue_members where venue_id = p_venue_id and user_id = p_actor_id for share;
    if not found then return 'NOT_FOUND'; end if;
  elsif p_actor_type is distinct from 'customer' then
    return 'NOT_FOUND';
  end if;

  select * into booking_row from bookings where venue_id = p_venue_id and id = p_booking_id
    and (p_actor_type = 'staff' or customer_id = p_actor_id);
  if not found then return 'NOT_FOUND'; end if;

  perform pg_advisory_xact_lock_shared(hashtextextended(p_venue_id::text, 2));
  perform pg_advisory_xact_lock(hashtextextended(
    p_venue_id::text || ':' || (booking_row.service_date - date '2000-01-01')::text, 3
  ));
  select * into booking_row from bookings where venue_id = p_venue_id and id = p_booking_id for update;
  if booking_row.status = 'checked_in' then return 'ALREADY_CHECKED_IN'; end if;
  if booking_row.status = 'cancelled' then return 'CANCELLED'; end if;

  cancelled_time := clock_timestamp();
  if p_actor_type = 'customer' then
    select cancel_cutoff_minutes into cutoff from venues where id = p_venue_id;
    if cancelled_time >= booking_row.service_at - make_interval(mins => cutoff) then return 'CUTOFF_PASSED'; end if;
  end if;

  update bookings set status = 'cancelled', cancelled_at = cancelled_time where id = p_booking_id;
  update booking_allocations set active = false where booking_id = p_booking_id;
  insert into booking_events (venue_id, booking_id, kind, actor_type, actor_id)
    values (p_venue_id, p_booking_id, 'cancelled', p_actor_type, p_actor_id);
  insert into notification_outbox (venue_id, booking_id, kind) values (p_venue_id, p_booking_id, 'cancelled');
  insert into audit_logs (venue_id, actor_type, actor_id, action, entity_id)
    values (p_venue_id, p_actor_type, p_actor_id, 'booking.cancelled', p_booking_id);
  return 'CANCELLED';
end
$$;

