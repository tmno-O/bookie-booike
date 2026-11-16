import { json, route } from "@/lib/http";
import { requireCron } from "@/server/cron-auth";
import { createAuditCheckpoints } from "@/server/services/audit-checkpoints";

export const maxDuration = 30;
export const POST = route(async (request) => {
  requireCron(request);
  return json(await createAuditCheckpoints());
});
