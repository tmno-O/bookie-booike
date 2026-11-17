"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  DEFAULT_CANCEL_DEADLINE_HOURS, DEFAULT_DAY_OF_REMINDER_HOURS, DEFAULT_REMINDER_HOURS, lineReminderSettings, MAX_DAY_OF_REMINDER_HOURS,
  MAX_REMINDER_HOURS, type LineReminderSettings,
} from "@/contracts/venue";
import { adminApi, asFailure, type Staff } from "../../admin-api";
import { AdminShell } from "../../admin-shell";
import { SettingsHeader } from "../settings-tabs";
import styles from "../../admin.module.css";
import page from "../settings-pages.module.css";

const reminders = [
  { key: "bookingReminderHours", title: "รายการจองที่ยืนยันแล้ว", timing: "ก่อนเวลาเริ่มการจอง",
    toggle: "ส่ง LINE เตือนล่วงหน้า", fallback: DEFAULT_REMINDER_HOURS, max: MAX_REMINDER_HOURS },
  { key: "dayOfReminderHours", title: "เตือนในวันจอง", timing: "ก่อนเวลาเริ่มการจองในวันนั้น (ไม่เกิน 24 ชั่วโมง)",
    toggle: "ส่ง LINE เตือนในวันจอง พร้อมที่อยู่และนโยบายเข้าร้าน", fallback: DEFAULT_DAY_OF_REMINDER_HOURS, max: MAX_DAY_OF_REMINDER_HOURS },
  { key: "cancelDeadlineReminderHours", title: "ใกล้หมดเวลายกเลิก", timing: "ก่อนหมดเวลาที่ลูกค้ายกเลิกเองได้",
    toggle: "ส่ง LINE เตือนให้ยกเลิกถ้าไม่สะดวกมา", fallback: DEFAULT_CANCEL_DEADLINE_HOURS, max: MAX_REMINDER_HOURS },
  { key: "specialReminderHours", title: "วันพิเศษ", timing: "ก่อนร้านเปิดให้บริการในวันพิเศษที่เลือกแจ้งข่าว",
    toggle: "ส่ง LINE เตือนล่วงหน้า", fallback: DEFAULT_REMINDER_HOURS, max: MAX_REMINDER_HOURS },
] as const;

type HourKey = (typeof reminders)[number]["key"];
type Draft = Record<HourKey, { enabled: boolean; hours: string }> & { checkInMessages: boolean };

function draftFrom(settings: LineReminderSettings): Draft {
  const hours = Object.fromEntries(reminders.map(({ key, fallback }) =>
    [key, { enabled: settings[key] !== null, hours: String(settings[key] ?? fallback) }])) as Record<HourKey, Draft[HourKey]>;
  return { ...hours, checkInMessages: settings.checkInMessages };
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
      setDraft(draftFrom(settings));
      setCanEdit(settings.canEdit);
    }).catch((cause) => {
      if (!active) return;
      const failure = asFailure(cause);
      if (failure.status === 401) router.replace("/admin/login");
      else setError(failure.status === 403 ? "เฉพาะเจ้าของร้านที่แก้ไขการแจ้งเตือน LINE ได้" : failure.message);
    });
    return () => { active = false; };
  }, [router]);

  function update(key: HourKey, patch: Partial<Draft[HourKey]>) {
    setDraft((current) => current && { ...current, [key]: { ...current[key], ...patch } });
    setNotice("");
  }

  async function save() {
    if (!draft || !canEdit || busy) return;
    setNotice("");
    const invalid = reminders.find(({ key, max }) => {
      const hours = Number(draft[key].hours);
      return draft[key].enabled && !(Number.isInteger(hours) && hours >= 1 && hours <= max);
    });
    if (invalid) return setError(`${invalid.title}: กรุณากรอกจำนวนเต็มตั้งแต่ 1 ถึง ${invalid.max.toLocaleString("th-TH")} ชั่วโมง`);
    const parsed = lineReminderSettings.safeParse({
      ...Object.fromEntries(reminders.map(({ key }) => [key, draft[key].enabled ? Number(draft[key].hours) : null])),
      checkInMessages: draft.checkInMessages,
    });
    if (!parsed.success) return setError("กรุณาตรวจค่าการแจ้งเตือนอีกครั้ง");
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
          {reminders.map(({ key, title, timing, toggle, max }) => <section className={styles.card} key={key} aria-labelledby={`${key}-title`}>
            <h2 id={`${key}-title`} className={styles.cardTitle}>{title}</h2>
            <label className={page.reminderToggle}>
              <input type="checkbox" checked={draft[key].enabled} disabled={!canEdit || busy}
                aria-label={`${toggle} (${title})`} onChange={(event) => update(key, { enabled: event.target.checked })} />
              {toggle}
            </label>
            <label htmlFor={key} className={styles.fieldLabelStrong}>{timing}</label>
            <div className={page.reminderAmount}>
              <input id={key} className={page.amount} type="number" inputMode="numeric" min={1} max={max} step={1}
                disabled={!canEdit || busy || !draft[key].enabled} value={draft[key].hours}
                onChange={(event) => update(key, { hours: event.target.value })} />
              <span>ชั่วโมง</span>
            </div>
          </section>)}
          <section className={styles.card} aria-labelledby="check-in-messages-title">
            <h2 id="check-in-messages-title" className={styles.cardTitle}>เช็กอินและขอบคุณ</h2>
            <label className={page.reminderToggle}>
              <input type="checkbox" checked={draft.checkInMessages} disabled={!canEdit || busy}
                onChange={(event) => { setDraft({ ...draft, checkInMessages: event.target.checked }); setNotice(""); }} />
              ส่ง LINE ต้อนรับเมื่อพนักงานกดเช็กอิน
            </label>
            <p className={page.note}>และส่งข้อความขอบคุณวันถัดไปเวลา 11:00 น. ตามเวลาร้าน</p>
          </section>
        </div>
        <p className={page.note}>ระบบส่งผลจองสำเร็จหรือไม่สำเร็จผ่าน LINE เมื่อได้ผลตัดสิน</p>
      </>}
    </AdminShell>
  );
}
