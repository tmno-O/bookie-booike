import { id } from "@/contracts/common";
import { partySizeFor } from "@/contracts/party";
import { availabilityQuery } from "@/contracts/venue";
import { input, json, route } from "@/lib/http";
import { venueAvailability } from "@/server/services/availability";

export const GET = route<{ venueId: string }>(async (request, params) => {
  const { date, partyBucket } = input(availabilityQuery, Object.fromEntries(new URL(request.url).searchParams));
  return json(await venueAvailability(input(id, params.venueId), date, partyBucket ? partySizeFor[partyBucket] : 1));
});
