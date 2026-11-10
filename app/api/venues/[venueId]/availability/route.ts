import { id, serviceDate } from "@/contracts/common";
import { input, json, route } from "@/lib/http";
import { venueAvailability } from "@/server/services/availability";

export const GET = route<{ venueId: string }>(async (request, params) =>
  json(await venueAvailability(
    input(id, params.venueId), input(serviceDate, new URL(request.url).searchParams.get("date")),
  )));
