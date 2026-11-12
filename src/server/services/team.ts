import type { Staff } from "@/lib/auth/staff-auth";
import { db } from "@/lib/db";
import { ApiError, notFound } from "@/lib/errors";
import { staffAudit } from "./audit";
import { staffChange } from "./venue";

export function getTeam(staff: Staff) {
  return db().begin("isolation level repeatable read read only", async (tx) => {
    const members = await tx`
      select u.email, coalesce(nullif(u.raw_user_meta_data->>'display_name', ''), split_part(u.email, '@', 1)) as display_name, m.role
      from venue_members m join auth.users u on u.id = m.user_id
      where m.venue_id = ${staff.venueId} and u.email is not null and u.deleted_at is null
      order by m.role, lower(u.email), u.id
    `;
    const canEdit = staff.role === "owner";
    const invites = canEdit ? await tx`
      select id, email, role, created_at from venue_invites where venue_id = ${staff.venueId} order by created_at, id
    ` : [];
    return { members, invites, canEdit };
  });
}

export function createInvite(staff: Staff, email: string) {
  return staffChange(staff, async (tx) => {
    const [member] = await tx`
      select m.user_id from venue_members m join auth.users u on u.id = m.user_id
      where m.venue_id = ${staff.venueId} and lower(u.email) = ${email}
    `;
    if (member) throw new ApiError(409, "ALREADY_MEMBER", "อีเมลนี้เป็นสมาชิกของทีมอยู่แล้ว");
    const [invite] = await tx`
      insert into venue_invites (venue_id, email, created_by)
      values (${staff.venueId}, ${email}, ${staff.userId})
      on conflict (venue_id, email) do nothing returning id, email, role, created_at
    `;
    if (!invite) throw new ApiError(409, "INVITE_EXISTS", "อีเมลนี้ถูกเชิญไว้แล้ว");
    await staffAudit(tx, staff, "team.invite_created", invite.id);
    return { invite };
  });
}

export function deleteInvite(staff: Staff, id: string) {
  return staffChange(staff, async (tx) => {
    const [removed] = await tx`
      delete from venue_invites where venue_id = ${staff.venueId} and id = ${id} returning id
    `;
    if (!removed) notFound("Invitation");
    await staffAudit(tx, staff, "team.invite_removed", id);
    return { ok: true };
  });
}
