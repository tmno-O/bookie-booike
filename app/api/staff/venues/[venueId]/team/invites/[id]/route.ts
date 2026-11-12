import { id } from "@/contracts/common";
import { input, json } from "@/lib/http";
import { deleteInvite } from "@/server/services/team";
import { staffRoute } from "@/server/staff-route";

export const DELETE = staffRoute<{ venueId: string; id: string }>(async (_request, staff, params) =>
  json(await deleteInvite(staff, input(id, params.id))), "FORBIDDEN");
