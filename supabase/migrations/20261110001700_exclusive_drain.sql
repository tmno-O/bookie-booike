-- Let callers that fire on every request (the API's after-response drain) skip when another such
-- drain is already running, so a burst does not hold one database connection per request.
-- Supabase Cron calls without p_exclusive and always runs, so a leaked lock cannot stall the queue.

drop procedure public.drain_booking_requests(integer, numeric, integer);

-- Transaction control is not allowed with a SET clause, so names are schema-qualified instead.
create procedure public.drain_booking_requests(
  p_max_items integer default 500,
  p_max_seconds numeric default 50,
  p_max_attempts integer default 5,
  p_exclusive boolean default false
)
language plpgsql as $$
declare
  drain_lock constant bigint := hashtextextended('booking-drain', 5);
  started timestamptz := clock_timestamp();
  processed integer := 0;
  head_id uuid;
  tries integer;
  failed boolean;
begin
  -- Session-level so it survives the commits below; released before returning.
  if p_exclusive and not pg_try_advisory_lock(drain_lock) then
    return;
  end if;

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

  if p_exclusive then
    perform pg_advisory_unlock(drain_lock);
  end if;
end
$$;

revoke all on procedure public.drain_booking_requests(integer, numeric, integer, boolean) from public, anon, authenticated;
