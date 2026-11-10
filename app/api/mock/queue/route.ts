import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/errors";
import { body, json, route } from "@/lib/http";
import { QUEUE_AHEAD, queueState, withDb } from "@/mock/db";
import { queueOpensAt } from "@/mock/schedule";
import { assertMockEnabled, requireUser } from "@/mock/session";
import { customerInput } from "@/mock/validation";

// Join the booking queue. Repeating the call returns the customer's existing open entry.
export const POST = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  const input = await body(request, customerInput);
  const { entry, state, created } = await withDb((db) => {
    const customer = requireUser(db, request).id;
    if (Date.now() < queueOpensAt(db)) throw new ApiError(403, "NOT_OPEN", "Booking has not opened yet");
    let found = db.queue.find((e) => e.customerId === customer && !e.bookingId);
    const created = !found;
    if (!found) {
      found = { id: randomUUID(), customerId: customer, ...input, createdAt: new Date().toISOString(),
        startPosition: QUEUE_AHEAD + 1, bookingId: null };
      db.queue.push(found);
    }
    return { entry: found, state: queueState(db, found), created };
  });
  return json({ requestId: entry.id, status: state.ready ? "ready" : "waiting", ...state },
    { status: created ? 201 : 200 });
});
