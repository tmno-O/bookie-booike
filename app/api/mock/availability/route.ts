import { serviceDate } from "@/contracts/common";
import { partyBucket } from "@/contracts/party";
import { ApiError } from "@/lib/errors";
import { input, json, route } from "@/lib/http";
import { addDays, today, withDb, zoneAvailability } from "@/mock/db";
import { availableAtFor, isNightOpen, isServiceNightOpen } from "@/mock/schedule";
import { assertMockEnabled } from "@/mock/session";

export const GET = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  const params = new URL(request.url).searchParams;
  const date = input(serviceDate, params.get("date"));
  const party = params.has("partyBucket") ? input(partyBucket, params.get("partyBucket")) : undefined;
  return json(await withDb((db) => {
    if (date < today() || date > addDays(today(), db.venue.maxAdvanceDays)) {
      throw new ApiError(422, "DATE_OUT_OF_RANGE", "Date is outside the bookable window");
    }
    const open = isNightOpen(db, date);
    return {
      serviceDate: date, open, opensAt: new Date(availableAtFor(db, date)).toISOString(),
      closed: !isServiceNightOpen(db, date),
      zones: zoneAvailability(db, date, party).map((z) => ({ ...z, available: z.available && open })),
    };
  }));
});
