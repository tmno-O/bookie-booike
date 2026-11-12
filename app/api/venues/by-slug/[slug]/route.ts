import { slug } from "@/contracts/common";
import { input, json, route } from "@/lib/http";
import { getPublicVenue } from "@/server/services/venue";

export const GET = route<{ slug: string }>(async (_request, params) =>
  json(await getPublicVenue(input(slug, params.slug))));
