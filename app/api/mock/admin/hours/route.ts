import { json, route } from "@/lib/http";
import { withDb } from "@/mock/db";
import { opensAtFor } from "@/mock/schedule";
import { assertMockEnabled } from "@/mock/session";
import { requireStaff } from "@/mock/staff";

// Opening schedule: standard rule plus per-night special days. Staff can read it; only the owner edits it.
export const GET = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  const staff = requireStaff(request);
  return json(await withDb((db) => ({
    standard: db.venue.schedule.standard,
    openWeekdays: db.venue.schedule.openWeekdays,
    closures: db.venue.schedule.closures.map((c) => ({ ...c,
      affectedBookings: db.bookings.filter((b) => b.status !== "cancelled" && b.serviceDate === c.serviceDate).length,
    })),
    specials: [...db.venue.schedule.specials].sort((a, b) => a.serviceDate.localeCompare(b.serviceDate))
      .map((s) => ({ ...s, opensAt: new Date(opensAtFor(db, s.serviceDate)).toISOString() })),
    canEdit: staff.role === "owner",
  })));
});
