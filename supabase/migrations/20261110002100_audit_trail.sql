alter table public.booking_requests add column received_at timestamptz;
update public.booking_requests set received_at = created_at;
alter table public.booking_requests alter column received_at set not null,
  alter column received_at set default clock_timestamp();

alter table public.audit_logs add column seq bigint, add column prev_hash bytea, add column row_hash bytea;
alter table public.audit_logs alter column created_at set default clock_timestamp();

-- Explicit UTC formatting makes verification independent of session timezone and DateStyle.
create function public.audit_row_hash(p_seq bigint, p_id bigint, p_prev bytea, p_venue uuid,
  p_actor_type text, p_actor_id uuid, p_action text, p_entity uuid, p_details jsonb, p_time timestamptz)
returns bytea language sql immutable set search_path = public, pg_temp as $$
  select sha256(p_prev || convert_to(jsonb_build_object(
    'seq', p_seq, 'id', p_id, 'venue_id', p_venue, 'actor_type', p_actor_type, 'actor_id', p_actor_id,
    'action', p_action, 'entity_id', p_entity, 'details', p_details,
    'created_at', to_char(p_time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  )::text, 'UTF8'));
$$;

-- ALTER TABLE holds the exclusive migration lock while existing history is chained.
do $$
declare r record; previous_venue uuid; previous bytea; number bigint;
begin
  for r in select * from public.audit_logs order by venue_id, id loop
    if previous_venue is distinct from r.venue_id then
      previous := decode(repeat('00', 32), 'hex'); number := 0; previous_venue := r.venue_id;
    end if;
    number := number + 1;
    update public.audit_logs set seq = number, prev_hash = previous,
      row_hash = public.audit_row_hash(number, r.id, previous, r.venue_id, r.actor_type, r.actor_id,
        r.action, r.entity_id, r.details, r.created_at)
      where id = r.id returning row_hash into previous;
  end loop;
end
$$;
alter table public.audit_logs alter column seq set not null, alter column prev_hash set not null, alter column row_hash set not null;
create unique index audit_logs_venue_seq on public.audit_logs(venue_id, seq);
create index audit_logs_entity on public.audit_logs(venue_id, entity_id, seq);
create index audit_logs_request on public.audit_logs(venue_id, (details->>'request_id'), seq);
create index audit_logs_service_date on public.audit_logs(venue_id, (details->>'service_date'), seq);

create function public.chain_audit_row() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare previous record;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.venue_id::text, 7));
  select seq, row_hash into previous from audit_logs where venue_id = new.venue_id order by seq desc limit 1;
  new.seq := coalesce(previous.seq, 0) + 1;
  new.prev_hash := coalesce(previous.row_hash, decode(repeat('00', 32), 'hex'));
  new.created_at := clock_timestamp();
  new.row_hash := audit_row_hash(new.seq, new.id, new.prev_hash, new.venue_id, new.actor_type,
    new.actor_id, new.action, new.entity_id, new.details, new.created_at);
  return new;
end
$$;
create trigger audit_logs_chain before insert on public.audit_logs for each row execute function public.chain_audit_row();

create function public.reject_audit_mutation() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin raise exception 'AUDIT_APPEND_ONLY'; end
$$;
create trigger audit_logs_immutable before update or delete on public.audit_logs for each row execute function public.reject_audit_mutation();
create trigger audit_logs_no_truncate before truncate on public.audit_logs for each statement execute function public.reject_audit_mutation();
revoke update, delete, truncate on public.audit_logs from public, anon, authenticated, service_role;

create function public.verify_audit_chain(p_venue_id uuid, p_from bigint default null, p_to bigint default null)
returns table (checked integer, first_bad_seq bigint, first_bad_id bigint, last_seq bigint, head_hash text)
language plpgsql stable set search_path = public, pg_temp as $$
declare r audit_logs; previous bytea := decode(repeat('00', 32), 'hex'); previous_seq bigint := 0;
begin
  checked := 0;
  if p_from is not null then
    select a.row_hash, a.seq into previous, previous_seq from audit_logs a
      where a.venue_id = p_venue_id and a.seq < p_from order by a.seq desc limit 1;
    previous := coalesce(previous, decode(repeat('00', 32), 'hex')); previous_seq := coalesce(previous_seq, 0);
  end if;
  for r in select * from audit_logs a where a.venue_id = p_venue_id
    and (p_from is null or a.seq >= p_from) and (p_to is null or a.seq <= p_to) order by a.seq loop
    checked := checked + 1;
    if first_bad_seq is null and (r.seq <> previous_seq + 1 or r.prev_hash <> previous or r.row_hash <>
      audit_row_hash(r.seq, r.id, r.prev_hash, r.venue_id, r.actor_type, r.actor_id, r.action, r.entity_id, r.details, r.created_at)) then
      first_bad_seq := r.seq; first_bad_id := r.id;
    end if;
    previous := r.row_hash; previous_seq := r.seq;
    last_seq := r.seq; head_hash := encode(r.row_hash, 'hex');
  end loop;
  return next;
end
$$;

create function public.booking_request_evidence(r public.booking_requests, p_code text, p_table uuid, p_zone uuid)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('request_id', r.id, 'booking_id', r.booking_id,
    'reference', (select reference from bookings where venue_id = r.venue_id and id = r.booking_id), 'ticket_id', r.ticket_id,
    'ticket_seq', (select seq::text from queue_tickets where id = r.ticket_id),
    'ticket_created_at', (select created_at from queue_tickets where id = r.ticket_id),
    'queue_seq', r.queue_seq::text, 'received_at', r.received_at, 'decided_at', r.decided_at,
    'result_code', p_code, 'table_id', p_table, 'zone_id', p_zone, 'service_date', r.service_date,
    'actor', jsonb_build_object('type', r.actor_type, 'id', r.actor_id));
$$;

create function public.audit_queue_ticket() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare event text;
begin
  if tg_op = 'INSERT' then event := 'queue.ticket_issued';
  elsif new.status is not distinct from old.status then return new;
  else event := 'queue.ticket_' || new.status; end if;
  insert into audit_logs (venue_id, actor_type, actor_id, action, entity_id, details)
    values (new.venue_id, 'customer', new.customer_id, event, new.id,
      jsonb_build_object('ticket_id', new.id, 'ticket_seq', new.seq::text, 'ticket_created_at', new.created_at,
        'ready_at', new.ready_at, 'status', new.status));
  return new;
end
$$;
create trigger queue_tickets_audit after insert or update of status on public.queue_tickets
  for each row execute function public.audit_queue_ticket();

create function public.audit_request_received() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  insert into audit_logs (venue_id, actor_type, actor_id, action, entity_id, details)
    values (new.venue_id, new.actor_type, new.actor_id, 'booking.request_received', new.id,
      booking_request_evidence(new, upper(new.status), new.table_id, new.zone_id));
  return new;
end
$$;
create trigger booking_requests_audit_received after insert on public.booking_requests
  for each row execute function public.audit_request_received();

create or replace function public.reject_booking_request(p_request_id uuid, p_reason text)
returns public.booking_requests language plpgsql set search_path = public, pg_temp as $$
declare req booking_requests;
begin
  select * into req from booking_requests where id = p_request_id for update;
  if not found or req.status in ('confirmed', 'rejected') then return req; end if;
  update booking_requests set status = 'rejected', result_code = p_reason, decided_at = clock_timestamp()
    where id = req.id returning * into req;
  insert into audit_logs (venue_id, actor_type, action, entity_id, details)
    values (req.venue_id, 'system', 'booking.rejected', req.id,
      booking_request_evidence(req, p_reason, req.table_id, req.zone_id));
  return req;
end
$$;

revoke all on function public.audit_row_hash(bigint, bigint, bytea, uuid, text, uuid, text, uuid, jsonb, timestamptz),
  public.chain_audit_row(), public.reject_audit_mutation(), public.verify_audit_chain(uuid, bigint, bigint),
  public.booking_request_evidence(public.booking_requests, text, uuid, uuid), public.audit_queue_ticket(),
  public.audit_request_received() from public, anon, authenticated;

create or replace function public.process_booking_request(p_request_id uuid)
returns public.booking_requests
language plpgsql set search_path = public, pg_temp as $$
declare
  req booking_requests;
  candidate record;
  selection_mode text;
  allocation text;
  skip_release boolean;
  booking_state text := 'confirmed';
  reason text;
  new_booking_id uuid;
  decision_time timestamptz;
begin
  select * into req from booking_requests where id = p_request_id for update;
  if not found or req.status in ('confirmed', 'rejected') then return req; end if;

  -- Share the venue lock with config mutations, and serialize allocation per service night.
  perform pg_advisory_xact_lock_shared(hashtextextended(req.venue_id::text, 2));
  perform pg_advisory_xact_lock(hashtextextended(req.venue_id::text || ':' || (req.service_date - date '2000-01-01')::text, 3));
  select v.table_selection_mode, coalesce(s.allocation_mode, 'auto')
  into selection_mode, allocation
  from venues v left join venue_settings s on s.venue_id = v.id where v.id = req.venue_id;
  if req.party_bucket is null and (selection_mode = 'customer_picks') <> (req.table_id is not null) then
    return reject_booking_request(req.id, 'SELECTION_MODE_CHANGED');
  end if;

  if req.party_bucket is not null then
    if exists (select 1 from zones where venue_id = req.venue_id and id = req.zone_id and status = 'closed') then
      return reject_booking_request(req.id, 'ZONE_CLOSED');
    end if;
    if allocation = 'manual' then booking_state := 'pending_allocation'; end if;
  end if;

  skip_release := req.source = 'staff_assisted' and req.party_bucket is not null;
  decision_time := clock_timestamp();
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
  end if;
  update booking_requests set status = 'confirmed', booking_id = new_booking_id, decided_at = decision_time
    where id = req.id returning * into req;
  insert into audit_logs (venue_id, actor_type, actor_id, action, entity_id, details)
    values (req.venue_id, req.actor_type, req.actor_id, 'booking.' || booking_state, new_booking_id,
      booking_request_evidence(req, upper(booking_state), case when booking_state = 'confirmed' then candidate.id end, candidate.zone_id));
  return req;
end
$$;
