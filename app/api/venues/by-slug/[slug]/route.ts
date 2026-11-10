import { slug } from "@/contracts/common";
import { input, json, route } from "@/lib/http";
import { getVenue } from "@/server/services/venue";

export const GET = route<{ slug: string }>(async (_request, params) =>
  json(await getVenue({ slug: input(slug, params.slug) })));
