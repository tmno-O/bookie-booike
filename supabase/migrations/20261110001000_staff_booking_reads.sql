create index bookings_venue_night_recent
  on public.bookings (venue_id, service_date, created_at desc, id desc);
create index booking_requests_night_in_flight
  on public.booking_requests (venue_id, service_date) where status in ('pending_publish', 'queued');
