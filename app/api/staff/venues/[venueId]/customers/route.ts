import { z } from "zod";
import { input, json } from "@/lib/http";
import { staffRoute } from "@/server/staff-route";
import { searchVenueCustomers } from "@/server/services/staff";

export const GET = staffRoute(async (request, staff) => {
  const query = input(z.string().trim().min(1).max(120), new URL(request.url).searchParams.get("q"));
  return json({ customers: await searchVenueCustomers(staff.venueId, query) });
});
