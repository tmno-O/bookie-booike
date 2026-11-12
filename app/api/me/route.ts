import { customerSession } from "@/lib/auth/customer-session";
import { db } from "@/lib/db";
import { json, route } from "@/lib/http";

export const GET = route(async (request) => {
  const { venueId, customerId } = await customerSession(request);
  const [user] = await db()`
    select customer_id as user_id, display_name from venue_customers
    where venue_id = ${venueId} and customer_id = ${customerId}
  `;
  return json({ user });
});
