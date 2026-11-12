insert into public.venues (id, slug, name, description)
values ('10000000-0000-4000-8000-000000000001', 'bookie-demo', 'Bookie Demo', 'ร้านตัวอย่างสำหรับทดลองจองโต๊ะ')
on conflict (id) do nothing;

insert into public.venue_line_integrations (venue_id, provider_id, channel_id, liff_id)
values ('10000000-0000-4000-8000-000000000001', 'bookie-demo-provider', '1234567890', '1234567890-BookieDemo')
on conflict (venue_id) do nothing;

insert into public.zones (id, venue_id, name, capacity)
values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'โซนหลัก', 20)
on conflict (id) do nothing;

insert into public.venue_tables (id, venue_id, zone_id, name, capacity, price_satang)
values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'A1', 2, null),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'A2', 4, null),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'A3', 6, 35000)
on conflict (id) do nothing;

-- Demo map and party buckets. VIP uses a custom table for the 15-seat bucket.
insert into public.zones (id, venue_id, name, capacity, seat_managed)
values
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'VIP', 15, false),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'Indoor', 24, true),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'Outdoor', 24, true)
on conflict (id) do nothing;

insert into public.venue_tables (id, venue_id, zone_id, name, capacity)
values
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'VIP 1', 15),
  ('30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'Indoor 1', 12),
  ('30000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'Indoor 2', 12),
  ('30000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', 'Outdoor 1', 12),
  ('30000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', 'Outdoor 2', 12)
on conflict (id) do nothing;

-- Local Supabase Auth fixtures. Never apply this seed to a deployed environment.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000', fixture.id, 'authenticated', 'authenticated',
  fixture.email, extensions.crypt('BookieDemo123!', extensions.gen_salt('bf')), now(),
  '', '', '', '', '{"provider":"email","providers":["email"]}', jsonb_build_object('display_name', fixture.display_name), now(), now()
from (values
  ('90000000-0000-4000-8000-000000000001'::uuid, 'owner@bookie.test', 'เจ้าของร้าน'),
  ('90000000-0000-4000-8000-000000000002'::uuid, 'staff@bookie.test', 'พนักงาน')
) fixture(id, email, display_name)
on conflict (id) do nothing;

insert into auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
select gen_random_uuid(), u.id::text, u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now()
from auth.users u where u.id in ('90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000002')
on conflict (provider_id, provider) do nothing;

insert into public.venue_members (venue_id, user_id, role) values
  ('10000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 'owner'),
  ('10000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000002', 'staff')
on conflict (venue_id, user_id) do nothing;
