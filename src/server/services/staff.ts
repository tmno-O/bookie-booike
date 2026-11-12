import type { TransactionSql } from "postgres";
import { db } from "@/lib/db";

export async function searchVenueCustomers(venueId: string, query: string) {
  return db()`
    select customer_id as id, display_name, phone_last_four
    from venue_customers where venue_id = ${venueId}
      and (strpos(lower(display_name), lower(${query})) > 0 or strpos(phone_last_four, ${query}) > 0
        or strpos(staff_contact_phone, ${query}) > 0)
    order by display_name, customer_id limit 30
  `;
}

export async function upsertStaffContact(tx: TransactionSql, venueId: string, name: string, phone: string) {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`${venueId}:${phone}`}, 6))`;
  const [existing] = await tx<{ customerId: string }[]>`
    update venue_customers set display_name = ${name} where venue_id = ${venueId} and staff_contact_phone = ${phone}
    returning customer_id
  `;
  if (existing) return existing.customerId;
  const [customer] = await tx<{ id: string }[]>`insert into customers default values returning id`;
  await tx`
    insert into venue_customers (venue_id, customer_id, display_name, phone_last_four, staff_contact_phone)
    values (${venueId}, ${customer.id}, ${name}, ${phone.slice(-4)}, ${phone})
  `;
  return customer.id;
}
