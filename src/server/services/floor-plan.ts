import type postgres from "postgres";
import { z } from "zod";
import type { floorPlan } from "@/contracts/floor-plan";
import type { Staff } from "@/lib/auth/staff-auth";
import { db } from "@/lib/db";
import { ApiError, notFound } from "@/lib/errors";
import { floorPlanState, type FloorPlan } from "@/lib/floor-plan";
import { staffAudit } from "./audit";
import { staffChange } from "./venue";

type Row = { draft: FloorPlan; published: FloorPlan | null; publishedAt: Date | null };

export async function staffFloorPlan(venueId: string) {
  const [row] = await db()<Row[]>`
    select draft, published, published_at from venue_floor_plans where venue_id = ${venueId}
  `;
  return row ? floorPlanState(row.draft, row.published, row.publishedAt?.toISOString() ?? null) : floorPlanState(null, null, null);
}

/** Customers only ever see the published copy; a venue that never published has no plan (the app shows its default map). */
export async function publicFloorPlan(venueId: string) {
  const [row] = await db()<{ published: FloorPlan | null }[]>`
    select p.published from venues v left join venue_floor_plans p on p.venue_id = v.id where v.id = ${venueId}
  `;
  return row ? { plan: row.published } : notFound("Venue");
}

async function assertZonesBelongToVenue(tx: postgres.TransactionSql, venueId: string, plan: FloorPlan) {
  const ids = plan.zones.map((zone) => zone.zoneId);
  if (!ids.every((zoneId) => z.uuid().safeParse(zoneId).success)) {
    throw new ApiError(400, "UNKNOWN_ZONE", "ผังอ้างถึงโซนที่ไม่มีอยู่ในร้าน");
  }
  if (!ids.length) return;
  const found = await tx`select id from zones where venue_id = ${venueId} and id = any(${ids}::uuid[])`;
  if (found.length !== new Set(ids).size) throw new ApiError(400, "UNKNOWN_ZONE", "ผังอ้างถึงโซนที่ไม่มีอยู่ในร้าน");
}

export async function saveFloorPlanDraft(staff: Staff, plan: z.infer<typeof floorPlan>) {
  await staffChange(staff, async (tx) => {
    await assertZonesBelongToVenue(tx, staff.venueId, plan);
    await tx`
      insert into venue_floor_plans (venue_id, draft) values (${staff.venueId}, ${tx.json(plan as unknown as postgres.JSONValue)})
      on conflict (venue_id) do update set draft = excluded.draft, updated_at = now()
    `;
    await staffAudit(tx, staff, "floor_plan.saved", staff.venueId);
  });
  return staffFloorPlan(staff.venueId);
}

export async function publishFloorPlan(staff: Staff) {
  await staffChange(staff, async (tx) => {
    const [row] = await tx<{ draft: FloorPlan }[]>`select draft from venue_floor_plans where venue_id = ${staff.venueId} for update`;
    if (!row) throw new ApiError(409, "NO_FLOOR_PLAN", "บันทึกผังก่อนเผยแพร่");
    await assertZonesBelongToVenue(tx, staff.venueId, row.draft);
    await tx`update venue_floor_plans set published = draft, published_at = now() where venue_id = ${staff.venueId}`;
    await staffAudit(tx, staff, "floor_plan.published", staff.venueId);
  });
  return staffFloorPlan(staff.venueId);
}
