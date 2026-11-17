-- More LINE notices for a booking:
--   day_of           on the day, a few hours before the reservation (with the entry policy)
--   cancel_deadline  a few hours before the customer can no longer cancel
--   checked_in       right after staff check the guest in
--   thank_you        the morning after a checked-in night (11:00 venue time)
-- Each owner setting can be turned off. Scheduled notices wait in the outbox with status 'scheduled'.

alter table public.venues
  add column day_of_reminder_hours integer default 2 check (day_of_reminder_hours between 1 and 24),
  add column cancel_deadline_reminder_hours integer default 3 check (cancel_deadline_reminder_hours between 1 and 8760),
  add column check_in_messages boolean not null default true;

-- Replace every outbox rule that names the reminder kind, so the new scheduled kinds follow the same rules.
do $$
declare rule record;
begin
  for rule in
    select conname from pg_constraint
    where conrelid = 'public.notification_outbox'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%reminder%'
  loop
    execute format('alter table public.notification_outbox drop constraint %I', rule.conname);
  end loop;
end
$$;

alter table public.notification_outbox
  add constraint notification_outbox_kind_check check (kind in (
    'received', 'confirmed', 'cancelled', 'reminder', 'rejected', 'day_of', 'cancel_deadline', 'checked_in', 'thank_you'
  )),
  add constraint notification_outbox_scheduled_kind check (
    status <> 'scheduled' or kind in ('reminder', 'day_of', 'cancel_deadline', 'thank_you')),
  add constraint notification_outbox_scheduled_not_pending check (
    kind not in ('reminder', 'day_of', 'cancel_deadline', 'thank_you') or status <> 'pending'),
  add constraint notification_outbox_scheduled_at check (
    (kind in ('reminder', 'day_of', 'cancel_deadline', 'thank_you')) = (reminder_at is not null));

-- When a scheduled notice is due under the venue's current settings, or null when it is turned off.
create function public.booking_notice_due(p_kind text, p_booking public.bookings, p_venue public.venues)
returns timestamptz language sql stable set search_path = public, pg_temp as $$
  select case p_kind
    when 'reminder' then line_reminder_at(p_booking.service_at, p_venue.booking_reminder_hours)
    -- The day-of notice adds nothing when the regular reminder already arrives as late or later.
    when 'day_of' then case when p_venue.booking_reminder_hours is null or p_venue.booking_reminder_hours > p_venue.day_of_reminder_hours
      then line_reminder_at(p_booking.service_at, p_venue.day_of_reminder_hours) end
    when 'cancel_deadline' then case when p_venue.customer_cancel_enabled
      then line_reminder_at(p_booking.service_at - make_interval(mins => p_venue.cancel_cutoff_minutes), p_venue.cancel_deadline_reminder_hours) end
    when 'thank_you' then case when p_venue.check_in_messages
      then ((p_booking.service_date + 1) + time '11:00') at time zone p_venue.timezone end
  end;
$$;

-- Same contract as sync_booking_reminders(): a policy edit replaces jobs that were never attempted.
create function public.sync_booking_schedule(p_venue_id uuid, p_booking_id uuid default null)
returns void language plpgsql set search_path = public, pg_temp as $$
declare venue venues;
begin
  select * into venue from venues where id = p_venue_id for share;
  if not found then return; end if;
  if p_booking_id is null then
    delete from notification_outbox where venue_id = p_venue_id and kind in ('day_of', 'cancel_deadline')
      and status = 'scheduled' and attempts = 0;
    update notification_outbox set status = 'skipped', last_error = 'REMINDER_SETTINGS_CHANGED'
      where venue_id = p_venue_id and kind in ('day_of', 'cancel_deadline') and status = 'scheduled' and attempts > 0;
  end if;
  insert into notification_outbox (venue_id, booking_id, kind, status, reminder_at, next_attempt_at)
    select p_venue_id, b.id, k.kind, 'scheduled', due.at, due.at
    from bookings b cross join (values ('day_of'), ('cancel_deadline')) k(kind)
    cross join lateral (select booking_notice_due(k.kind, b, venue) as at) due
    where b.venue_id = p_venue_id and b.status = 'confirmed' and b.source = 'liff'
      and (p_booking_id is null or b.id = p_booking_id) and due.at > statement_timestamp()
    on conflict (booking_id, kind) do nothing;
end;
$$;

create function public.enqueue_booking_schedule()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  perform sync_booking_schedule(new.venue_id, new.id);
  return new;
end;
$$;

create trigger bookings_enqueue_schedule after insert or update of status on public.bookings
  for each row when (new.status = 'confirmed') execute function public.enqueue_booking_schedule();

-- Check-in sends a welcome now and a thank-you the next morning.
create function public.enqueue_check_in_notices()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare venue venues; thanks timestamptz;
begin
  select * into venue from venues where id = new.venue_id;
  if not venue.check_in_messages or new.source <> 'liff' then return new; end if;
  insert into notification_outbox (venue_id, booking_id, kind) values (new.venue_id, new.id, 'checked_in')
    on conflict (booking_id, kind) do nothing;
  thanks := booking_notice_due('thank_you', new, venue);
  if thanks > statement_timestamp() then
    insert into notification_outbox (venue_id, booking_id, kind, status, reminder_at, next_attempt_at)
      values (new.venue_id, new.id, 'thank_you', 'scheduled', thanks, thanks)
      on conflict (booking_id, kind) do nothing;
  end if;
  return new;
end;
$$;

create trigger bookings_enqueue_check_in after update of status on public.bookings
  for each row when (new.status = 'checked_in' and old.status is distinct from 'checked_in')
  execute function public.enqueue_check_in_notices();

create function public.sync_booking_schedule_on_settings_change()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  perform sync_booking_schedule(new.id);
  return new;
end;
$$;

create trigger venues_sync_booking_schedule after update of day_of_reminder_hours, cancel_deadline_reminder_hours,
  booking_reminder_hours, cancel_cutoff_minutes, customer_cancel_enabled, timezone on public.venues
  for each row execute function public.sync_booking_schedule_on_settings_change();

select public.sync_booking_schedule(id) from public.venues;

revoke all on function public.booking_notice_due(text, public.bookings, public.venues),
  public.sync_booking_schedule(uuid, uuid), public.enqueue_booking_schedule(), public.enqueue_check_in_notices(),
  public.sync_booking_schedule_on_settings_change()
  from public, anon, authenticated;
