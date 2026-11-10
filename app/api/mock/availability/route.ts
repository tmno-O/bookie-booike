import { z } from "zod";
import { ApiError } from "@/lib/errors";
import { input, json, route } from "@/lib/http";
import { addDays, today, withDb, zoneAvailability } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";

export const GET = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  const date = input(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), new URL(request.url).searchParams.get("date"));
  return json(await withDb((db) => {
    if (date < today() || date > addDays(today(), db.venue.maxAdvanceDays)) {
      throw new ApiError(422, "DATE_OUT_OF_RANGE", "Date is outside the bookable window");
    }
    return { serviceDate: date, zones: zoneAvailability(db, date) };
  }));
});
