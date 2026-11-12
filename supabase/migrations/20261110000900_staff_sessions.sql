create table public.staff_sessions (
  token_hash text primary key,
  venue_id uuid not null,
  user_id uuid not null,
  expires_at timestamptz not null,
  foreign key (venue_id, user_id) references public.venue_members on delete cascade
);
create index staff_sessions_expiration on public.staff_sessions (expires_at);
alter table public.staff_sessions enable row level security;
revoke all on public.staff_sessions from anon, authenticated;
