alter table public.booking_releases add column title text check (length(title) <= 120);
alter table public.venue_customers add column announcements_opt_out boolean not null default false;

create table public.release_announcements (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id),
  service_date date not null,
  title text not null check (length(title) between 1 and 120),
  opens_at timestamptz not null,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (venue_id, service_date, opens_at, title),
  unique (venue_id, id)
);
create table public.announcement_outbox (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null,
  venue_id uuid not null,
  customer_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'dead')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default clock_timestamp(),
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (venue_id, announcement_id) references public.release_announcements(venue_id, id),
  foreign key (venue_id, customer_id) references public.venue_customers,
  unique (announcement_id, customer_id)
);
create index announcement_outbox_pending on public.announcement_outbox(next_attempt_at) where status = 'pending';
create index announcement_outbox_customer on public.announcement_outbox(venue_id, customer_id);
alter table public.release_announcements enable row level security;
alter table public.announcement_outbox enable row level security;
revoke all on public.release_announcements, public.announcement_outbox from public, anon, authenticated;

-- Caller holds the same venue configuration lock as booking decisions.
-- The release, announcement, and audience are committed together by the service transaction.
create function public.announce_release(p_venue_id uuid, p_date date, p_title text, p_opens_at timestamptz, p_staff_id uuid)
returns uuid language plpgsql set search_path = public, pg_temp as $$
declare announcement uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_venue_id::text, 2));
  if not service_night_open(p_venue_id, p_date) then raise exception 'CLOSED'; end if;
  if not exists (select 1 from booking_releases where venue_id = p_venue_id and service_date = p_date and opens_at = p_opens_at) then
    raise exception 'RELEASE_NOT_FOUND';
  end if;
  insert into release_announcements (venue_id, service_date, title, opens_at, created_by)
    values (p_venue_id, p_date, p_title, p_opens_at, p_staff_id)
    on conflict (venue_id, service_date, opens_at, title) do nothing returning id into announcement;
  if announcement is null then
    select id into announcement from release_announcements
      where venue_id = p_venue_id and service_date = p_date and opens_at = p_opens_at and title = p_title;
    return announcement;
  end if;
  insert into announcement_outbox (announcement_id, venue_id, customer_id)
    select announcement, p_venue_id, c.customer_id from venue_customers c
    where c.venue_id = p_venue_id and not c.announcements_opt_out
      and exists (select 1 from bookings b where b.venue_id = c.venue_id and b.customer_id = c.customer_id)
    on conflict (announcement_id, customer_id) do nothing;
  return announcement;
end
$$;
revoke all on function public.announce_release(uuid, date, text, timestamptz, uuid) from public, anon, authenticated;

create function public.announcement_expires_at(p_venue_id uuid, p_date date)
returns timestamptz language sql stable set search_path = public, pg_temp as $$
  select coalesce(
    (select closes_at from booking_releases where venue_id = p_venue_id and service_date = p_date),
    (select max(r.ends_at) from venue_tables t cross join lateral effective_rule(t.id, p_date) r where t.venue_id = p_venue_id),
    ((p_date + 1) + time '02:00') at time zone 'Asia/Bangkok'
  );
$$;
revoke all on function public.announcement_expires_at(uuid, date) from public, anon, authenticated;
