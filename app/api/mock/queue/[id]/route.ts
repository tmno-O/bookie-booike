import { json, route } from "@/lib/http";
import { notFound } from "@/lib/errors";
import { queueState, withDb } from "@/mock/db";
import { assertMockEnabled, requireUser } from "@/mock/session";

export const GET = route<{ id: string }>(async (request, params) => {
  assertMockEnabled();
  return json(await withDb((db) => {
    const customer = requireUser(db, request).id;
    const entry = db.queue.find((e) => e.id === params.id && e.customerId === customer);
    if (!entry) notFound("Queue request");
    const state = queueState(db, entry);
    return {
      requestId: entry.id, ...state, bookingId: entry.bookingId,
      status: entry.bookingId ? "booked" : state.ready ? "ready" : "waiting",
    };
  }));
});
