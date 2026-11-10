create table public.booking_rate_limits (
  scope text not null,
  window_start timestamptz not null,
  hits integer not null check (hits > 0),
  primary key (scope, window_start)
);
create index booking_rate_limits_expiration on public.booking_rate_limits (window_start);
alter table public.booking_rate_limits enable row level security;
revoke all on public.booking_rate_limits from anon, authenticated;
