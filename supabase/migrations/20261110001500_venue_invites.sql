create table public.venue_invites (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  email text not null check (email = lower(trim(email)) and length(email) between 3 and 254),
  role text not null default 'staff' check (role = 'staff'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (venue_id, email)
);
alter table public.venue_invites enable row level security;
revoke all on public.venue_invites from anon, authenticated;
