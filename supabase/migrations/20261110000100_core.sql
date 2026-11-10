create table public.venues (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  description text,
  contact text,
  map_url text,
  image_url text,
  timezone text not null default 'Asia/Bangkok',
  table_selection_mode text not null default 'customer_picks'
    check (table_selection_mode in ('customer_picks', 'auto_assign')),
  cancel_cutoff_minutes integer not null default 120 check (cancel_cutoff_minutes >= 0)
);

create table public.venue_members (
  venue_id uuid not null references public.venues(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'staff')),
  primary key (venue_id, user_id)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table public.customer_identities (
  provider_id text not null,
  subject text not null,
  customer_id uuid not null references public.customers(id),
  primary key (provider_id, subject)
);

create table public.venue_customers (
  venue_id uuid not null references public.venues(id),
  customer_id uuid not null references public.customers(id),
  display_name text not null,
  phone_last_four text check (phone_last_four ~ '^[0-9]{4}$'),
  primary key (venue_id, customer_id)
);

create table public.customer_sessions (
  token_hash text primary key,
  venue_id uuid not null,
  customer_id uuid not null,
  expires_at timestamptz not null,
  foreign key (venue_id, customer_id) references public.venue_customers on delete cascade
);
create index customer_sessions_expiration on public.customer_sessions (expires_at);

create table public.zones (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id),
  name text not null,
  capacity integer not null check (capacity > 0),
  status text not null default 'active' check (status in ('active', 'closed')),
  unique (venue_id, id)
);

create table public.venue_tables (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null,
  zone_id uuid not null,
  name text not null,
  capacity integer not null check (capacity > 0),
  price_satang integer check (price_satang >= 0),
  status text not null default 'active' check (status in ('active', 'closed')),
  foreign key (venue_id, zone_id) references public.zones (venue_id, id),
  unique (venue_id, id)
);
create index venue_tables_zone on public.venue_tables (venue_id, zone_id);

create table public.booking_rules (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id),
  scope text not null check (scope in ('venue', 'zone', 'table')),
  zone_id uuid,
  table_id uuid,
  version integer not null check (version > 0),
  min_notice_minutes integer check (min_notice_minutes between 0 and 525600),
  max_advance_days integer check (max_advance_days between 0 and 365),
  open_weekdays smallint[] check (open_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  closed boolean,
  service_start time without time zone,
  service_end time without time zone,
  created_at timestamptz not null default now(),
  foreign key (venue_id, zone_id) references public.zones (venue_id, id),
  foreign key (venue_id, table_id) references public.venue_tables (venue_id, id),
  unique nulls not distinct (venue_id, scope, zone_id, table_id, version),
  check (
    (scope = 'venue' and zone_id is null and table_id is null)
    or (scope = 'zone' and zone_id is not null and table_id is null)
    or (scope = 'table' and zone_id is null and table_id is not null)
  )
);

create table public.booking_releases (
  venue_id uuid not null references public.venues(id),
  service_date date not null,
  opens_at timestamptz not null,
  closes_at timestamptz check (closes_at > opens_at),
  primary key (venue_id, service_date)
);

create table public.venue_line_integrations (
  venue_id uuid primary key references public.venues(id),
  provider_id text not null,
  channel_id text not null,
  liff_id text not null,
  channel_secret_ciphertext text,
  access_token_ciphertext text
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  venue_id uuid not null references public.venues(id),
  actor_type text not null check (actor_type in ('customer', 'staff', 'system')),
  actor_id uuid,
  action text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_venue_time on public.audit_logs (venue_id, created_at desc);

do $$
declare relation text;
begin
  foreach relation in array array[
    'venues', 'venue_members', 'customers', 'customer_identities', 'venue_customers',
    'customer_sessions', 'zones', 'venue_tables', 'booking_rules', 'booking_releases',
    'venue_line_integrations', 'audit_logs'
  ] loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('revoke all on public.%I from anon, authenticated', relation);
  end loop;
end
$$;
