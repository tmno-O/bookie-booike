import { dashboardQuery } from "@/contracts/staff";
import { input, json } from "@/lib/http";
import { bangkokDate } from "@/lib/service-date";
import { staffDashboard } from "@/server/services/bookings";
import { staffRoute } from "@/server/staff-route";

export const GET = staffRoute(async (request, staff) => {
  const { date } = input(dashboardQuery, Object.fromEntries(new URL(request.url).searchParams));
  return json(await staffDashboard(staff.venueId, date ?? bangkokDate()));
});
