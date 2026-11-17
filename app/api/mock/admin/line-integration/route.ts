import { lineIntegrationPatch } from "@/contracts/venue";
import { ApiError } from "@/lib/errors";
import { body, json, route } from "@/lib/http";
import { withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireOwner } from "@/mock/staff";

// Owner-only LINE settings. The mock keeps whether a token is set, never the token itself.
export const GET = route(async (request) => {
  assertMockEnabled();
  requireOwner(request);
  return json({ integration: await withDb((db) => db.lineIntegration) });
});

export const PATCH = route(async (request) => {
  assertMockEnabled();
  requireOwner(request);
  const patch = await body(request, lineIntegrationPatch);
  if (!Object.keys(patch).length) throw new ApiError(400, "EMPTY_PATCH", "Provide a field to update");
  return json({ integration: await withDb((db) => {
    const { channelSecret, channelAccessToken, ...ids } = patch;
    Object.assign(db.lineIntegration, ids);
    if (channelSecret !== undefined) db.lineIntegration.hasChannelSecret = channelSecret !== null;
    if (channelAccessToken !== undefined) db.lineIntegration.hasAccessToken = channelAccessToken !== null;
    return db.lineIntegration;
  }) });
});
