import { availabilityQuery } from "@/contracts/venue";
import { partySizeFor } from "@/contracts/party";
import { db } from "@/lib/db";
import { input, json } from "@/lib/http";
import { zoneAvailability } from "@/server/services/availability";
import { staffRoute } from "@/server/staff-route";

export const GET = staffRoute(async (request, staff) => {
  const { date, partyBucket } = input(availabilityQuery, Object.fromEntries(new URL(request.url).searchParams));
  return json({ zones: await zoneAvailability(db(), staff.venueId, date, partyBucket ? partySizeFor[partyBucket] : 1, {
    skipRelease: true, allowPending: true,
  }) });
});
