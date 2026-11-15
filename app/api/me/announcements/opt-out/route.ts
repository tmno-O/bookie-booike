import { optOutInput } from "@/contracts/announcements";
import { customerSession } from "@/lib/auth/customer-session";
import { requireSameOrigin } from "@/lib/auth/permissions";
import { body, json, route } from "@/lib/http";
import { setAnnouncementOptOut } from "@/server/services/announcements";

export const POST = route(async (request) => {
  requireSameOrigin(request);
  const customer = await customerSession(request);
  return json(await setAnnouncementOptOut(customer, (await body(request, optOutInput)).optOut));
});
