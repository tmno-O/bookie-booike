import { db } from "@/lib/db";
import { getVenue } from "./venue";

export async function venueAvailability(venueId: string, serviceDate: string) {
  await getVenue({ venueId });
  const tables = await db()`select * from venue_availability(${venueId}, ${serviceDate})`;
  return { venueId, serviceDate, tables };
}
