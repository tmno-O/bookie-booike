import type postgres from "postgres";
import type { Staff } from "@/lib/auth/staff-auth";

export async function staffAudit(
  tx: postgres.TransactionSql, staff: Staff, action: string, entityId: string | null, details: object = {},
) {
  await tx`
    insert into audit_logs (venue_id, actor_type, actor_id, action, entity_id, details)
    values (${staff.venueId}, 'staff', ${staff.userId}, ${action}, ${entityId}, ${tx.json(details as import("postgres").JSONValue)})
  `;
}
