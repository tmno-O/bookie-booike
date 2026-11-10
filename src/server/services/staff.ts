import { db } from "@/lib/db";

export async function searchVenueCustomers(venueId: string, query: string) {
  return db()`
    select customer_id as id, display_name, phone_last_four
    from venue_customers where venue_id = ${venueId}
      and (strpos(lower(display_name), lower(${query})) > 0 or strpos(phone_last_four, ${query}) > 0)
    order by display_name, customer_id limit 30
  `;
}
