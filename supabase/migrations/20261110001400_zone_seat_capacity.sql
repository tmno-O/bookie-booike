alter table public.zones add column seat_managed boolean not null default false;
create index zones_venue_name_ci on public.zones (venue_id, lower(name));
