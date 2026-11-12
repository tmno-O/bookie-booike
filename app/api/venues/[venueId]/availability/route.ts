import { z } from "zod";
import { partyBucket, partySizeFor } from "@/contracts/party";
import { id, serviceDate } from "@/contracts/common";
import { input, json, route } from "@/lib/http";
import { venueAvailability } from "@/server/services/availability";

const query = z.object({ date: serviceDate, partyBucket: partyBucket.optional() });

export const GET = route<{ venueId: string }>(async (request, params) => {
  const { date, partyBucket } = input(query, Object.fromEntries(new URL(request.url).searchParams));
  return json(await venueAvailability(input(id, params.venueId), date, partyBucket ? partySizeFor[partyBucket] : 1));
});
