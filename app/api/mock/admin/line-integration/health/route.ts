import { json, route } from "@/lib/http";
import { withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireOwner } from "@/mock/staff";
import { lineReport } from "@/server/services/line-health";

// The mock has no LINE connection, so it reports a typical venue: ready once a token is saved.
export const GET = route(async (request) => {
  assertMockEnabled();
  requireOwner(request);
  const integration = await withDb((db) => db.lineIntegration);
  const ready = integration.hasAccessToken;
  return json(lineReport({
    integration, token: ready ? "valid" : "missing",
    bot: ready ? { name: "Bookie Demo", basicId: "@bookiedemo" } : null,
    verifyReal: true, pushEnabled: true, cronSecret: true, scheduler: "found", backlog: 0,
    friends: ready ? { checked: 3, friends: 2 } : null,
    deliveries: ready ? { total: 4, sent: 4, failed: 0, topError: null }
      : { total: 3, sent: 0, failed: 3, topError: "LINE_PUSH_NOT_CONFIGURED" },
  }));
});
