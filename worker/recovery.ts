import { db } from "@/lib/db";
import { publishBookingRequest } from "@/server/services/booking-request";

export async function reconcilePending(venueId?: string) {
  const sql = db();
  const venue = venueId ? sql`and venue_id = ${venueId}` : sql``;
  const requests = await sql<{ id: string }[]>`
    select id from booking_requests where status = 'pending_publish'
      and created_at < now() - interval '10 seconds'
      ${venue}
    order by created_at, id limit 50
  `;
  let published = 0;
  for (const request of requests) {
    if (await publishBookingRequest(request.id)) published++;
  }
  await sql`delete from booking_rate_limits where window_start < now() - interval '1 hour'`;
  await sql`delete from customer_sessions where expires_at < now()`;
  return published;
}
