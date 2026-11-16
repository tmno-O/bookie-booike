import { z } from "zod";
import { input, json, route } from "@/lib/http";
import { queueRowView } from "@/mock/booking-view";
import { today, withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireStaff } from "@/mock/staff";

// Customer requests for one service night, in the order they were sent after booking opened.
export const GET = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  requireStaff(request);
  const date = input(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), new URL(request.url).searchParams.get("date") ?? today());
  return json(await withDb((db) => {
    const requests = db.bookings.filter((b) => b.serviceDate === date && b.channel === "line" && b.status !== "cancelled")
      .sort((a, b) => (a.queueNo ?? 0) - (b.queueNo ?? 0)).map(queueRowView);
    return { serviceDate: date, today: today(), pending: requests.filter((r) => r.status === "pending").length, requests };
  }));
});
