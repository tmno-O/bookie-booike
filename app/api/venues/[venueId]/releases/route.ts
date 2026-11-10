import { id } from "@/contracts/common";
import { input, json, route } from "@/lib/http";
import { releases } from "@/server/services/venue";

export const GET = route<{ venueId: string }>(async (_request, params) =>
  json({ releases: await releases(input(id, params.venueId)) }));
