import { json } from "@/lib/http";
import { getTeam } from "@/server/services/team";
import { staffRoute } from "@/server/staff-route";

export const GET = staffRoute(async (_request, staff) => json(await getTeam(staff)));
