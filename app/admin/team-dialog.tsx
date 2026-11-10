"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { adminApi, asFailure } from "./admin-api";
import styles from "./admin.module.css";

type Member = { email: string; displayName: string; role: "owner" | "staff" };
type Invite = { id: string; email: string; role: "staff" };
type Team = { members: Member[]; invites: Invite[]; canEdit: boolean };

const ROLE_LABEL = { owner: "เจ้าของร้าน", staff: "พนักงานหน้าร้าน" } as const;
const ROLE_POWER = { owner: "สิทธิ์ทั้งหมด", staff: "จัดการการจองและคิว" } as const;
const ERRORS: Record<string, string> = {
  INVITE_EXISTS: "อีเมลนี้ถูกเชิญไว้แล้ว",
  ALREADY_MEMBER: "อีเมลนี้เป็นสมาชิกของทีมอยู่แล้ว",
  FORBIDDEN: "เฉพาะเจ้าของร้านที่เชิญพนักงานได้",
};

// Team and permissions, with the invite step (Figma: ทีมและสิทธิ์ → เชิญพนักงาน).
export default function TeamDialog({ onClose, onInvited }: { onClose: () => void; onInvited: (message: string) => void }) {
  const [team, setTeam] = useState<Team>();
  const [view, setView] = useState<"team" | "invite">("team");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  const load = () => adminApi<Team>("/admin/team").then(setTeam).catch((e) => setError(asFailure(e).message));
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, []);
  useEffect(() => { if (view === "invite") emailRef.current?.focus(); }, [view]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function sendInvite(e: FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("กรุณากรอกอีเมลให้ถูกต้อง");
    setBusy(true); setError("");
    try {
      await adminApi("/admin/team/invites", { method: "POST", body: { email: email.trim(), role: "staff" } });
      onInvited(`บันทึกคำเชิญ ${email.trim().toLowerCase()} แล้ว`);
    } catch (err) {
      const f = asFailure(err); setError(ERRORS[f.code] ?? f.message); setBusy(false);
    }
  }

  async function cancelInvite(id: string) {
    setError("");
    try { await adminApi(`/admin/team/invites/${id}`, { method: "DELETE" }); await load(); }
    catch (err) { setError(asFailure(err).message); }
  }

  const row = (label: string, value: string) => (
    <div className={styles.dRow} key={label}><span className={styles.dLabel}>{label}</span><p className={styles.dValue}>{value}</p></div>
  );

  return (
    <div className={styles.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="team-title">
        <h2 id="team-title" className={styles.dialogTitle}>{view === "team" ? "ทีมและสิทธิ์" : "เชิญพนักงาน"}</h2>
        <p className={styles.dialogSub}>{view === "team" ? "จัดการผู้ใช้งานภายในร้าน" : "กรอกอีเมลของพนักงานที่ต้องการเชิญ"}</p>

        {view === "team" ? (
          <>
            <div className={styles.dRows}>
              {row(ROLE_LABEL.owner, ROLE_POWER.owner)}
              {row(ROLE_LABEL.staff, ROLE_POWER.staff)}
            </div>
            <p className={styles.miniHead}>สมาชิกในทีม</p>
            {team?.members.map((m) => (
              <div key={m.email} className={styles.memberRow}>
                <span>{m.displayName}<br /><span className={styles.memberMeta}>{m.email}</span></span>
                <span className={styles.memberMeta}>{ROLE_LABEL[m.role]}</span>
              </div>
            ))}
            {team && team.invites.length > 0 && <p className={styles.miniHead}>คำเชิญที่รอการตอบรับ</p>}
            {team?.invites.map((i) => (
              <div key={i.id} className={styles.memberRow}>
                <span>{i.email}<br /><span className={styles.memberMeta}>{ROLE_LABEL[i.role]} · รอการตอบรับ</span></span>
                {team.canEdit && <button type="button" className={styles.linkBtn} onClick={() => cancelInvite(i.id)} aria-label={`ยกเลิกคำเชิญ ${i.email}`}>ยกเลิก</button>}
              </div>
            ))}
            {error && <p role="alert" className={styles.dError}>{error}</p>}
            <div className={styles.dActions}>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose}>กลับ</button>
              {team?.canEdit && <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => { setError(""); setView("invite"); }}>เชิญพนักงาน</button>}
            </div>
          </>
        ) : (
          <form onSubmit={sendInvite} noValidate>
            <div className={styles.dRows}>
              <label className={styles.field}><span className={styles.fieldLabel}>อีเมล</span>
                <input ref={emailRef} className={styles.input} type="email" value={email} placeholder="staff@example.com" autoComplete="off"
                  onChange={(e) => setEmail(e.target.value)} /></label>
              <label className={styles.field}><span className={styles.fieldLabel}>สิทธิ์</span>
                <select className={styles.input} defaultValue="staff"><option value="staff">{ROLE_LABEL.staff}</option></select></label>
            </div>
            {error && <p role="alert" className={styles.dError}>{error}</p>}
            <div className={styles.dActions}>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} disabled={busy} onClick={() => { setError(""); setView("team"); }}>กลับ</button>
              <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy}>{busy ? "กำลังบันทึก…" : "ยืนยันคำเชิญ"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
