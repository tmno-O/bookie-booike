-- Database-backed booking queue for hosts without a long-running SQS worker (QUEUE_DRIVER=db).
-- Requests are decided in insert order per venue and service night, the same grouping SQS FIFO used.

alter table public.booking_requests
  add column queue_seq bigint generated always as identity,
  add column attempts integer not null default 0 check (attempts >= 0);

create index booking_requests_queued
  on public.booking_requests (venue_id, service_date, queue_seq) where status = 'queued';

-- Decide queued requests one at a time, committing after each so customers see results immediately.
-- Only the oldest queued request of each night may be taken, and a night whose head is locked by
-- another runner is skipped, so concurrent runners never reorder a night.
-- Transaction control is not allowed with a SET clause, so names are schema-qualified instead.
create procedure public.drain_booking_requests(
  p_max_items integer default 500,
  p_max_seconds numeric default 50,
  p_max_attempts integer default 5
)
language plpgsql as $$
declare
  started timestamptz := clock_timestamp();
  processed integer := 0;
  head_id uuid;
  tries integer;
  failed boolean;
begin
  loop
    exit when processed >= p_max_items or clock_timestamp() - started > make_interval(secs => p_max_seconds);

    select r.id into head_id
    from (
      select distinct on (venue_id, service_date) id, queue_seq
      from public.booking_requests
      where status = 'queued'
      order by venue_id, service_date, queue_seq
    ) h
    join public.booking_requests r on r.id = h.id
    where r.status = 'queued'
    order by h.queue_seq
    limit 1
    for update of r skip locked;
    exit when head_id is null;

    failed := false;
    begin
      perform public.process_booking_request(head_id);
    exception when others then
      failed := true;
      update public.booking_requests set attempts = attempts + 1 where id = head_id returning attempts into tries;
      if tries >= p_max_attempts then
        perform public.reject_booking_request(head_id, 'SYSTEM_ERROR');
      end if;
      raise warning 'Booking request % failed (attempt %): %', head_id, tries, sqlerrm;
    end;
    commit;
    processed := processed + 1;
    head_id := null;
    -- Leave a failing request for the next run instead of retrying it in a tight loop.
    exit when failed;
  end loop;
end
$$;

-- Periodic cleanup that the Node worker's reconcile loop does in SQS mode.
create function public.booking_housekeeping()
returns void
language plpgsql set search_path = public, pg_temp as $$
declare
  due uuid;
begin
  for due in
    select distinct t.venue_id from queue_tickets t left join venue_settings s on s.venue_id = t.venue_id
    where t.status = 'ready' and t.ready_at <= now() - make_interval(secs => coalesce(s.ready_ttl_seconds, 120))
    order by t.venue_id limit 50
  loop
    perform advance_queue(due);
  end loop;
  delete from booking_rate_limits where window_start < now() - interval '1 hour';
  delete from customer_sessions where expires_at < now();
  delete from staff_sessions where expires_at < now();
end
$$;

revoke all on procedure public.drain_booking_requests(integer, numeric, integer) from public, anon, authenticated;
revoke all on function public.booking_housekeeping() from public, anon, authenticated;
