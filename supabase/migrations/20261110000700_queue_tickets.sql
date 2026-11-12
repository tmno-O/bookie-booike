alter table public.venue_settings
  add column admit_window integer not null default 1 check (admit_window between 1 and 1000),
  add column ready_ttl_seconds integer not null default 120 check (ready_ttl_seconds between 15 and 3600);

create table public.queue_tickets (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null,
  customer_id uuid not null,
  contact_name text not null,
  contact_phone text not null,
  seq bigint generated always as identity,
  status text not null default 'waiting' check (status in ('waiting', 'ready', 'used', 'expired')),
  created_at timestamptz not null default clock_timestamp(),
  ready_at timestamptz,
  foreign key (venue_id, customer_id) references public.venue_customers on delete cascade,
  unique (venue_id, id),
  unique (seq),
  check (status = 'waiting' or ready_at is not null)
);
create unique index queue_tickets_one_active
  on public.queue_tickets (venue_id, customer_id) where status in ('waiting', 'ready');
create index queue_tickets_active_order
  on public.queue_tickets (venue_id, seq) where status in ('waiting', 'ready');
create index queue_tickets_expiration
  on public.queue_tickets (ready_at, venue_id) where status = 'ready';
alter table public.queue_tickets enable row level security;
revoke all on public.queue_tickets from anon, authenticated;

create function public.advance_queue(p_venue_id uuid)
returns void
language plpgsql set search_path = public, pg_temp as $$
declare
  v_now timestamptz;
  v_ttl integer;
  v_window integer;
begin
  -- Lock the same venue before assigning a sequence or changing admission state.
  perform pg_advisory_xact_lock(hashtextextended(p_venue_id::text, 5));
  v_now := clock_timestamp();
  select coalesce(s.admit_window, 1), coalesce(s.ready_ttl_seconds, 120)
  into v_window, v_ttl
  from venues v left join venue_settings s on s.venue_id = v.id where v.id = p_venue_id;
  if not found then return; end if;

  update queue_tickets set status = 'expired'
  where venue_id = p_venue_id and status = 'ready' and ready_at <= v_now - make_interval(secs => v_ttl);

  update queue_tickets t set status = 'ready', ready_at = v_now
  from (
    select id from queue_tickets
    where venue_id = p_venue_id and status in ('waiting', 'ready')
    order by seq limit v_window
  ) head
  where t.id = head.id and t.status = 'waiting';
end
$$;
revoke all on function public.advance_queue(uuid) from public, anon, authenticated;
