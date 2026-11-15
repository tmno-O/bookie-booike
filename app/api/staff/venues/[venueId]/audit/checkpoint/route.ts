import { json } from "@/lib/http";
import { latestCheckpoint } from "@/server/services/audit-checkpoints";
import { staffRoute } from "@/server/staff-route";

/** Owners download the latest signed checkpoint to keep a copy outside the system. */
export const GET = staffRoute(async (_request, staff) => json(await latestCheckpoint(staff.venueId)), true);
