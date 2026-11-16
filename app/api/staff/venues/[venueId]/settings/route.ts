import { z } from "zod";
import { settingsPatch, shopProfileInput, venueSlugPatch } from "@/contracts/venue";
import { body, json } from "@/lib/http";
import { staffRoute } from "@/server/staff-route";
import { changeVenue, getVenue, shopProfile } from "@/server/services/venue";

export const GET = staffRoute(async (_request, staff) => {
  const venue = await getVenue(staff);
  return json({ ...venue, profile: shopProfile(venue), canEdit: true });
}, "FORBIDDEN");

export const PUT = staffRoute(async (request, staff) => {
  const updated = await changeVenue(staff, await body(request, shopProfileInput), "venue.shop_profile_saved");
  return json({ profile: shopProfile(updated) });
}, "FORBIDDEN");
export const PATCH = staffRoute(async (request, staff) => {
  const patch = await body(request, z.union([venueSlugPatch, settingsPatch]));
  return json(await changeVenue(staff, patch, "slug" in patch ? "venue.profile_updated" : "venue.settings_updated"));
}, true);
