import { z } from "zod";
import { input, json, route } from "@/lib/http";
import { PARTY_SIZE, today, withDb } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { requireStaff } from "@/mock/staff";

// Staff overview for one service night: totals, the booking list and zone seat usage.
export const GET = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  requireStaff(request);
  const param = new URL(request.url).searchParams.get("date") ?? today();
  const date = input(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), param);
  return json(await withDb((db) => {
    const night = db.bookings.filter((b) => b.serviceDate === date)
      .sort((a, b) => a.reference.localeCompare(b.reference));
    const waiting = db.queue.filter((e) => !e.bookingId).length;
    return {
      venueName: db.venue.name,
      serviceDate: date,
      metrics: {
        bookings: night.length,
        guests: night.reduce((sum, b) => sum + PARTY_SIZE[b.party], 0),
        pendingRequests: night.filter((b) => b.status === "pending").length + waiting,
        checkedIn: night.filter((b) => b.status === "checked_in").length,
      },
      bookings: night.map(({ id, reference, name, phone, party, zoneName, channel, status }) =>
        ({ id, reference, name, phone, party, zoneName, channel, status })),
      zones: db.zones.map((z) => ({
        id: z.id, name: z.name, seats: z.seats,
        booked: night.filter((b) => b.zoneId === z.id).reduce((sum, b) => sum + PARTY_SIZE[b.party], 0),
      })),
    };
  }));
});
