-- Lets a frequent Supabase Cron job call the LINE drain endpoint only when there is work to deliver,
-- so notifications go out within seconds without an HTTP request every tick while the outboxes are idle.
-- Mirrors the selection rules of worker/notifications.ts and worker/announcements.ts.
create function public.line_notifications_due()
returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (
      select 1 from notification_outbox n
      where ((n.status in ('pending', 'scheduled') and n.next_attempt_at <= now())
          or (n.status = 'sending' and n.lease_until <= now()))
        and not exists (
          select 1 from notification_outbox prior where prior.booking_id = n.booking_id
            and prior.status in ('pending', 'sending')
            and ((prior.kind = 'received' and n.kind in ('confirmed', 'cancelled'))
              or (prior.kind = 'confirmed' and n.kind = 'cancelled'))
        )
    )
    or exists (
      select 1 from announcement_outbox
      where (status = 'pending' and next_attempt_at <= now()) or (status = 'sending' and lease_until <= now())
    )
    or exists (
      select 1 from announcement_reminder_outbox
      where (status = 'pending' and next_attempt_at <= now()) or (status = 'sending' and lease_until <= now())
    )
    or exists (select 1 from release_announcements where not fanout_done);
$$;
revoke all on function public.line_notifications_due() from public, anon, authenticated;
