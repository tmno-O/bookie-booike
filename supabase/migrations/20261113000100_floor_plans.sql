-- Venue floor plan: an owner edits a draft and publishes it; customers only ever read the published copy.
-- Shapes are validated by the API (src/contracts/floor-plan.ts) before they reach this table.
create table public.venue_floor_plans (
  venue_id uuid primary key references public.venues(id) on delete cascade,
  draft jsonb not null,
  published jsonb,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(draft) = 'object' and (published is null or jsonb_typeof(published) = 'object'))
);

alter table public.venue_floor_plans enable row level security;
revoke all on public.venue_floor_plans from anon, authenticated;
