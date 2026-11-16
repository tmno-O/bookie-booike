alter table public.notification_outbox
  add column lease_until timestamptz,
  add column lease_token uuid,
  drop constraint notification_outbox_kind_check,
  drop constraint notification_outbox_status_check,
  add check (kind in ('received', 'confirmed', 'cancelled', 'reminder', 'rejected')),
  add check (status in ('pending', 'scheduled', 'sending', 'sent', 'skipped', 'dead')),
  add check (
    (status = 'sending' and lease_until is not null and lease_token is not null) or
    (status <> 'sending' and lease_until is null and lease_token is null)
  );

create index notification_outbox_lease_expiry on public.notification_outbox (lease_until) where status = 'sending';

create or replace function public.process_booking_request(p_request_id uuid)
returns public.booking_requests
language plpgsql set search_path = public, pg_temp as $$
declare
  req booking_requests;
  candidate record;
  selection_mode text;
  allocation text;
  large_mode text;
  skip_release boolean;
  large boolean;
  booking_state text := 'confirmed';
  reason text;
  new_booking_id uuid;
  decision_time timestamptz;
begin
  select * into req from booking_requests where id = p_request_id for update;
  if not found or req.status in ('confirmed', 'rejected') then return req; end if;

  -- Share the venue lock with config mutations, and serialize allocation per service night.
  perform pg_advisory_xact_lock_shared(hashtextextended(req.venue_id::text, 2));
  if req.source = 'liff' then
    perform pg_advisory_xact_lock(hashtextextended(req.venue_id::text || ':' || req.customer_id::text, 6));
    if exists (select 1 from customer_active_booking(req.venue_id, req.customer_id)) then
      return reject_booking_request(req.id, 'ACTIVE_BOOKING_EXISTS');
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(req.venue_id::text || ':' || (req.service_date - date '2000-01-01')::text, 3));
  select v.table_selection_mode, coalesce(s.allocation_mode, 'auto'), coalesce(s.large_party_mode, 'staff_review')
  into selection_mode, allocation, large_mode
  from venues v left join venue_settings s on s.venue_id = v.id where v.id = req.venue_id;
  if req.party_bucket is null and (selection_mode = 'customer_picks') <> (req.table_id is not null) then
    return reject_booking_request(req.id, 'SELECTION_MODE_CHANGED');
  end if;

  large := req.party_bucket = '12+';
  if req.party_bucket is not null then
    if exists (select 1 from zones where venue_id = req.venue_id and id = req.zone_id and status = 'closed') then
      return reject_booking_request(req.id, 'ZONE_CLOSED');
    end if;
    if large and large_mode = 'disabled' then return reject_booking_request(req.id, 'LARGE_PARTY_DISABLED'); end if;
    -- Large parties may need several tables, so staff always confirm them.
    if allocation = 'manual' or large then booking_state := 'pending_allocation'; end if;
  end if;

  skip_release := req.source = 'staff_assisted' and req.party_bucket is not null;
  decision_time := clock_timestamp();

  if req.source = 'liff' then
    reason := booking_window_issue(req.venue_id, req.service_date, decision_time);
    if reason is not null then return reject_booking_request(req.id, reason); end if;
  end if;

  if large then
    reason := zone_fits_party(req.venue_id, req.service_date, req.zone_id, req.party_size, decision_time, skip_release);
    if reason is not null then
      return reject_booking_request(req.id, case reason when 'TABLE_UNAVAILABLE' then 'ZONE_FULL' when 'NOT_OPEN_YET' then 'NIGHT_NOT_OPEN' else reason end);
    end if;
    select c.* into candidate
    from booking_candidates_for(req.venue_id, req.service_date, null, req.zone_id, 1, req.service_at, decision_time, skip_release) c
    where c.result_code is null order by c.capacity desc, c.id limit 1;
  else
    select c.* into candidate
    from booking_candidates_for(
      req.venue_id, req.service_date, req.table_id, req.zone_id, req.party_size, req.service_at, decision_time, skip_release
    ) c
    where c.result_code is null
      and (booking_state = 'pending_allocation'
        or has_booking_capacity(req.venue_id, req.service_date, c.id, c.zone_id, c.zone_capacity, req.party_size))
    order by c.capacity, c.id
    limit 1;

    if not found then
      select case when count(*) filter (where c.result_code is null or c.result_code = 'TABLE_UNAVAILABLE') > 0
          then 'TABLE_UNAVAILABLE' else min(c.result_code) end into reason
      from booking_candidates_for(
        req.venue_id, req.service_date, req.table_id, req.zone_id, req.party_size, req.service_at, decision_time, skip_release
      ) c;
      if req.party_bucket is not null then
        reason := case coalesce(reason, 'TABLE_UNAVAILABLE')
          when 'TABLE_UNAVAILABLE' then 'ZONE_FULL'
          when 'NOT_OPEN_YET' then 'NIGHT_NOT_OPEN'
          else reason end;
      end if;
      return reject_booking_request(req.id, coalesce(reason, 'TABLE_UNAVAILABLE'));
    end if;
  end if;

  insert into bookings (
    venue_id, request_id, customer_id, table_id, zone_id, service_date, service_at, party_size,
    status, source, contact_name, contact_phone
  )
  values (
    req.venue_id, req.id, req.customer_id, case when booking_state = 'confirmed' then candidate.id end,
    candidate.zone_id, req.service_date, candidate.service_at, req.party_size,
    booking_state, req.source,
    coalesce(req.contact_name, (select display_name from venue_customers where venue_id = req.venue_id and customer_id = req.customer_id)),
    req.contact_phone
  ) returning id into new_booking_id;
  if booking_state = 'confirmed' then
    insert into booking_allocations (venue_id, booking_id, table_id, service_date)
      values (req.venue_id, new_booking_id, candidate.id, req.service_date);
    insert into booking_events (venue_id, booking_id, kind, actor_type, actor_id)
      values (req.venue_id, new_booking_id, 'confirmed', req.actor_type, req.actor_id);
    insert into notification_outbox (venue_id, booking_id, kind)
      values (req.venue_id, new_booking_id, 'confirmed');
  elsif req.source = 'liff' and req.ticket_id is null then
    -- Legacy ticket clients still using the previous worker do not enqueue the new message kind.
    insert into notification_outbox (venue_id, booking_id, kind)
      values (req.venue_id, new_booking_id, 'received');
  end if;
  update booking_requests set status = 'confirmed', booking_id = new_booking_id, decided_at = decision_time
    where id = req.id returning * into req;
  insert into audit_logs (venue_id, actor_type, actor_id, action, entity_id, details)
    values (req.venue_id, req.actor_type, req.actor_id, 'booking.' || booking_state, new_booking_id,
      booking_request_evidence(req, upper(booking_state), case when booking_state = 'confirmed' then candidate.id end, candidate.zone_id));
  return req;
end
$$;
