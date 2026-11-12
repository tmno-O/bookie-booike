import { inviteInput } from "@/contracts/staff";
import { body, json } from "@/lib/http";
import { createInvite } from "@/server/services/team";
import { staffRoute } from "@/server/staff-route";

export const POST = staffRoute(async (request, staff) => {
  const { email } = await body(request, inviteInput);
  return json(await createInvite(staff, email), { status: 201 });
}, "FORBIDDEN");
