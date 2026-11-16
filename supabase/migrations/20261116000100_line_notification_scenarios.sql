alter table public.venues
  add column booking_reminder_hours integer default 24 check (booking_reminder_hours between 1 and 8760),
  add column special_reminder_hours integer default 24 check (special_reminder_hours between 1 and 8760);

create function public.line_reminder_at(p_starts_at timestamptz, p_hours integer)
returns timestamptz language sql immutable strict set search_path = public, pg_temp as $$
  select p_starts_at - make_interval(hours => p_hours);
$$;

create function public.special_day_starts_at(p_venue_id uuid, p_date date)
returns timestamptz language sql stable set search_path = public, pg_temp as $$
  select (p_date + coalesce(r.service_start, time '18:00')) at time zone v.timezone
  from venues v left join lateral (
    select service_start from booking_rules where venue_id = v.id and scope = 'venue'
    order by version desc limit 1
  ) r on true where v.id = p_venue_id;
$$;

alter table public.notification_outbox
  alter column booking_id drop not null,
  add column request_id uuid,
  add column reminder_at timestamptz,
  drop constraint notification_outbox_kind_check,
  drop constraint notification_outbox_status_check,
  add check (kind in ('confirmed', 'cancelled', 'reminder', 'rejected')),
  add check (status in ('pending', 'scheduled', 'sent', 'skipped', 'dead')),
  add check ((kind = 'rejected' and request_id is not null and booking_id is null) or
    (kind <> 'rejected' and booking_id is not null and request_id is null)),
  -- Older workers only read pending jobs. Keep reminders scheduled through every retry.
  add check (status <> 'scheduled' or kind = 'reminder'),
  add check (kind <> 'reminder' or status <> 'pending'),
  add check ((kind = 'reminder') = (reminder_at is not null)),
  add foreign key (venue_id, request_id) references public.booking_requests (venue_id, id),
  add unique (request_id, kind);

create index notification_outbox_scheduled on public.notification_outbox(next_attempt_at) where status = 'scheduled';

-- A policy edit replaces jobs that have never been attempted. Keep attempted jobs and their identities for deduplication.
create function public.sync_booking_reminders(p_venue_id uuid, p_booking_id uuid default null)
returns void language plpgsql set search_path = public, pg_temp as $$
declare hours integer;
begin
  select booking_reminder_hours into hours from venues where id = p_venue_id for share;
  if p_booking_id is null then
    delete from notification_outbox where venue_id = p_venue_id and kind = 'reminder' and status = 'scheduled' and attempts = 0;
    update notification_outbox set status = 'skipped', last_error = 'REMINDER_SETTINGS_CHANGED'
      where venue_id = p_venue_id and kind = 'reminder' and status = 'scheduled' and attempts > 0;
  end if;
  if hours is null then return; end if;
  insert into notification_outbox (venue_id, booking_id, kind, status, reminder_at, next_attempt_at)
    select p_venue_id, b.id, 'reminder', 'scheduled', due.at, due.at from bookings b
    cross join lateral (select line_reminder_at(b.service_at, hours) as at) due
    where b.venue_id = p_venue_id and b.status = 'confirmed' and (p_booking_id is null or b.id = p_booking_id)
      and due.at > statement_timestamp()
    on conflict (booking_id, kind) do nothing;
end;
$$;

create function public.enqueue_booking_reminder()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  perform sync_booking_reminders(new.venue_id, new.id);
  return new;
end;
$$;

create trigger bookings_enqueue_reminder after insert or update of status on public.bookings
  for each row when (new.status = 'confirmed') execute function public.enqueue_booking_reminder();

create function public.enqueue_booking_rejection()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  insert into notification_outbox (venue_id, request_id, kind)
    values (new.venue_id, new.id, 'rejected') on conflict (request_id, kind) do nothing;
  return new;
end;
$$;

create trigger booking_requests_enqueue_rejection after update of status on public.booking_requests
  for each row when (new.status = 'rejected' and old.status <> 'rejected' and new.source = 'liff')
  execute function public.enqueue_booking_rejection();

-- Store reminders separately so previous deployments keep their release audience and never send a reminder as an announcement.
create table public.announcement_reminder_outbox (like public.announcement_outbox including all);
alter table public.announcement_reminder_outbox
  add column reminder_at timestamptz not null,
  add foreign key (venue_id, announcement_id) references public.release_announcements (venue_id, id),
  add foreign key (venue_id, customer_id) references public.venue_customers;
alter table public.announcement_reminder_outbox enable row level security;
revoke all on public.announcement_reminder_outbox from public, anon, authenticated;

create function public.sync_special_day_reminders(p_venue_id uuid)
returns void language plpgsql set search_path = public, pg_temp as $$
declare hours integer;
begin
  select special_reminder_hours into hours from venues where id = p_venue_id for no key update;
  delete from announcement_reminder_outbox where venue_id = p_venue_id and status = 'pending' and attempts = 0;
  update announcement_reminder_outbox set status = 'skipped', last_error = 'REMINDER_SETTINGS_CHANGED'
    where venue_id = p_venue_id and status = 'pending' and attempts > 0;
  if hours is null then return; end if;
  insert into announcement_reminder_outbox (announcement_id, venue_id, customer_id, reminder_at, next_attempt_at)
    select o.announcement_id, o.venue_id, o.customer_id, due.at, due.at
    from release_announcements a
    join booking_releases r on r.venue_id = a.venue_id and r.service_date = a.service_date
      and r.opens_at = a.opens_at and r.title = a.title
    join announcement_outbox o on o.announcement_id = a.id
    join venue_customers c on c.venue_id = o.venue_id and c.customer_id = o.customer_id
    cross join lateral (select line_reminder_at(special_day_starts_at(a.venue_id, a.service_date), hours) as at) due
    where a.venue_id = p_venue_id and due.at > statement_timestamp() and not c.announcements_opt_out
    on conflict (announcement_id, customer_id) do nothing;
end;
$$;

create or replace function public.fanout_announcement(p_announcement_id uuid, p_batch integer default 1000)
returns boolean language plpgsql set search_path = public, pg_temp as $$
declare a release_announcements; picked integer; last_customer uuid; hours integer; due_at timestamptz;
begin
  -- Use the same lock order as policy changes, without taking the venue's booking advisory lock.
  select v.special_reminder_hours into hours from venues v join release_announcements announcement on announcement.venue_id = v.id
    where announcement.id = p_announcement_id for share of v;
  select * into a from release_announcements where id = p_announcement_id for update;
  if not found or a.fanout_done then return true; end if;
  due_at := line_reminder_at(special_day_starts_at(a.venue_id, a.service_date), hours);
  with batch as (
    select c.customer_id from venue_customers c
    where c.venue_id = a.venue_id and not c.announcements_opt_out
      and (a.fanout_cursor is null or c.customer_id > a.fanout_cursor)
      and exists (select 1 from bookings b where b.venue_id = c.venue_id and b.customer_id = c.customer_id)
    order by c.customer_id limit p_batch
  ), inserted as (
    insert into announcement_outbox (announcement_id, venue_id, customer_id)
      select a.id, a.venue_id, customer_id from batch
      on conflict (announcement_id, customer_id) do nothing
  ), reminders as (
    insert into announcement_reminder_outbox (announcement_id, venue_id, customer_id, reminder_at, next_attempt_at)
      select a.id, a.venue_id, customer_id, due_at, due_at from batch where due_at > statement_timestamp()
      on conflict (announcement_id, customer_id) do nothing
  )
  select count(*), max(customer_id::text)::uuid into picked, last_customer from batch;
  update release_announcements set fanout_cursor = coalesce(last_customer, fanout_cursor),
    fanout_done = picked < p_batch where id = a.id;
  return picked < p_batch;
end;
$$;

create function public.sync_line_reminders_on_settings_change()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.booking_reminder_hours is distinct from new.booking_reminder_hours then
    perform sync_booking_reminders(new.id);
  end if;
  if old.special_reminder_hours is distinct from new.special_reminder_hours or old.timezone is distinct from new.timezone then
    perform sync_special_day_reminders(new.id);
  end if;
  return new;
end;
$$;

create trigger venues_sync_line_reminders after update of booking_reminder_hours, special_reminder_hours, timezone on public.venues
  for each row execute function public.sync_line_reminders_on_settings_change();

create function public.sync_special_day_reminders_on_hours_change()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare previous_start time;
begin
  select service_start into previous_start from booking_rules where venue_id = new.venue_id and scope = 'venue'
    and version < new.version order by version desc limit 1;
  if coalesce(previous_start, time '18:00') <> coalesce(new.service_start, time '18:00') then
    perform sync_special_day_reminders(new.venue_id);
  end if;
  return new;
end;
$$;

create trigger booking_rules_sync_special_day_reminders after insert on public.booking_rules
  for each row when (new.scope = 'venue') execute function public.sync_special_day_reminders_on_hours_change();

select public.sync_booking_reminders(id), public.sync_special_day_reminders(id) from public.venues;

revoke all on function public.line_reminder_at(timestamptz, integer), public.special_day_starts_at(uuid, date),
  public.sync_booking_reminders(uuid, uuid), public.sync_special_day_reminders(uuid), public.enqueue_booking_reminder(),
  public.enqueue_booking_rejection(), public.sync_line_reminders_on_settings_change(), public.sync_special_day_reminders_on_hours_change()
  from public, anon, authenticated;
