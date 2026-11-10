insert into public.venues (id, slug, name, description)
values ('10000000-0000-4000-8000-000000000001', 'bookie-demo', 'Bookie Demo', 'ร้านตัวอย่างสำหรับทดลองจองโต๊ะ');

insert into public.venue_line_integrations (venue_id, provider_id, channel_id, liff_id)
values ('10000000-0000-4000-8000-000000000001', 'bookie-demo-provider', '1234567890', '1234567890-BookieDemo');

insert into public.zones (id, venue_id, name, capacity)
values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'โซนหลัก', 20);

insert into public.venue_tables (id, venue_id, zone_id, name, capacity, price_satang)
values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'A1', 2, null),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'A2', 4, null),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'A3', 6, 35000);
