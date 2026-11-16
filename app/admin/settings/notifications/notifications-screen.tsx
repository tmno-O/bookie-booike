"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DEFAULT_REMINDER_HOURS, lineReminderSettings, MAX_REMINDER_HOURS, type LineReminderSettings } from "@/contracts/venue";
import { adminApi, asFailure, type Staff } from "../../admin-api";
import { AdminShell } from "../../admin-shell";
import { SettingsHeader } from "../settings-tabs";
import styles from "../../admin.module.css";
import page from "../settings-pages.module.css";

const reminders = [
  { key: "bookingReminderHours", title: "รายการจองที่ยืนยันแล้ว", timing: "ก่อนเวลาเริ่มการจอง" },
  { key: "specialReminderHours", title: "วันพิเศษ", timing: "ก่อนร้านเปิดให้บริการในวันพิเศษที่เลือกแจ้งข่าว" },
] as const;

type Draft = Record<keyof LineReminderSettings, { enabled: boolean; hours: string }>;

function field(hours: number | null) {
  return { enabled: hours !== null, hours: String(hours ?? DEFAULT_REMINDER_HOURS) };
}

export default function NotificationsScreen() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff>();
  const [draft, setDraft] = useState<Draft>();
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    adminApi<{ staff: Staff }>("/admin/me").then(({ staff }) => { if (active) setStaff(staff); }).catch(() => undefined);
    adminApi<LineReminderSettings & { canEdit: boolean }>("/admin/settings").then((settings) => {
      if (!active) return;
      setDraft({ bookingReminderHours: field(settings.bookingReminderHours), specialReminderHours: field(settings.specialReminderHours) });
      setCanEdit(settings.canEdit);
    }).catch((cause) => {
      if (!active) return;
      const failure = asFailure(cause);
      if (failure.status === 401) router.replace("/admin/login");
      else setError(failure.status === 403 ? "เฉพาะเจ้าของร้านที่แก้ไขการแจ้งเตือน LINE ได้" : failure.message);
    });
    return () => { active = false; };
  }, [router]);

  function update(key: keyof Draft, patch: Partial<Draft[keyof Draft]>) {
    setDraft((current) => current && { ...current, [key]: { ...current[key], ...patch } });
    setNotice("");
  }

  async function save() {
    if (!draft || !canEdit || busy) return;
    setNotice("");
    const value = ({ enabled, hours }: Draft[keyof Draft]) => enabled ? Number(hours) : null;
    const parsed = lineReminderSettings.safeParse({
      bookingReminderHours: value(draft.bookingReminderHours), specialReminderHours: value(draft.specialReminderHours),
    });
    if (!parsed.success) return setError(`กรุณากรอกจำนวนเต็มตั้งแต่ 1 ถึง ${MAX_REMINDER_HOURS.toLocaleString("th-TH")} ชั่วโมง`);
    setBusy(true);
    setError("");
    try {
      await adminApi("/admin/settings", { method: "PATCH", body: parsed.data });
      setNotice("บันทึกการแจ้งเตือน LINE แล้ว");
    } catch (cause) { setError(asFailure(cause).message); }
    finally { setBusy(false); }
  }

  return (
    <AdminShell active="/admin/settings" staff={staff}>
      <SettingsHeader tab="notifications" canSave={canEdit} busy={busy} onSave={save} />
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {!draft && !error && <p role="status" className={page.note}>กำลังโหลดการตั้งค่า…</p>}
      {draft && <>
        <div className={styles.settingsGrid}>
          {reminders.map(({ key, title, timing }) => <section className={styles.card} key={key} aria-labelledby={`${key}-title`}>
            <h2 id={`${key}-title`} className={styles.cardTitle}>{title}</h2>
            <label className={page.reminderToggle}>
              <input type="checkbox" checked={draft[key].enabled} disabled={!canEdit || busy}
                aria-label={`ส่ง LINE เตือนล่วงหน้าสำหรับ${title}`} onChange={(event) => update(key, { enabled: event.target.checked })} />
              ส่ง LINE เตือนล่วงหน้า
            </label>
            <label htmlFor={key} className={styles.fieldLabelStrong}>{timing}</label>
            <div className={page.reminderAmount}>
              <input id={key} className={page.amount} type="number" inputMode="numeric" min={1} max={MAX_REMINDER_HOURS} step={1}
                disabled={!canEdit || busy || !draft[key].enabled} value={draft[key].hours}
                onChange={(event) => update(key, { hours: event.target.value })} />
              <span>ชั่วโมง</span>
            </div>
          </section>)}
        </div>
        <p className={page.note}>ระบบส่งผลจองสำเร็จหรือไม่สำเร็จผ่าน LINE เมื่อได้ผลตัดสิน</p>
      </>}
    </AdminShell>
  );
}
