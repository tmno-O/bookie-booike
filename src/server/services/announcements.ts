import type { Customer } from "@/lib/auth/customer-session";
import { db } from "@/lib/db";

export async function customerAnnouncements(customer: Customer) {
  const { venueId, customerId } = customer;
  return db().begin("isolation level repeatable read read only", async (tx) => {
    const [preference] = await tx`select announcements_opt_out as opted_out from venue_customers
      where venue_id = ${venueId} and customer_id = ${customerId}`;
    const announcements = await tx`
      select a.id, a.title, to_char(a.service_date, 'YYYY-MM-DD') as service_date, a.opens_at
      from release_announcements a join announcement_outbox o on o.announcement_id = a.id
      join booking_releases r on r.venue_id = a.venue_id and r.service_date = a.service_date and r.opens_at = a.opens_at
      where o.venue_id = ${venueId} and o.customer_id = ${customerId} and not ${preference.optedOut}
        and service_night_open(a.venue_id, a.service_date)
        and clock_timestamp() < announcement_expires_at(a.venue_id, a.service_date)
      order by a.opens_at, a.id limit 20
    `;
    return { announcements, optedOut: preference.optedOut as boolean };
  });
}

export function setAnnouncementOptOut(customer: Customer, optOut: boolean) {
  return db().begin(async (tx) => {
    await tx`update venue_customers set announcements_opt_out = ${optOut}
      where venue_id = ${customer.venueId} and customer_id = ${customer.customerId}`;
    if (optOut) await tx`update announcement_outbox set status = 'skipped', last_error = 'OPTED_OUT'
      where venue_id = ${customer.venueId} and customer_id = ${customer.customerId} and status = 'pending'`;
    return { optedOut: optOut };
  });
}
