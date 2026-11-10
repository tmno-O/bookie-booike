"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { adminApi, asFailure } from "./admin-api";
import styles from "./admin.module.css";

export type Standard = { daysBefore: number; time: string };

const ERRORS: Record<string, string> = {
  SPECIAL_DAY_EXISTS: "คืนนี้มีการตั้งเวลาเฉพาะอยู่แล้ว",
  DATE_IN_PAST: "คืนที่เลือกผ่านมาแล้ว",
  FORBIDDEN: "เฉพาะเจ้าของร้านที่แก้ไขได้",
};

export const daysLabel = (n: number) => (n === 0 ? "ในคืนที่จอง" : `${n} วันก่อนคืนที่จอง`);

function Frame({ title, sub, busy, onClose, onSubmit, error, children }: {
  title: string; sub: string; busy: boolean; onClose: () => void; onSubmit: (e: FormEvent) => void; error: string; children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  return (
    <div className={styles.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="hours-title">
        <h2 id="hours-title" className={styles.dialogTitle}>{title}</h2>
        <p className={styles.dialogSub}>{sub}</p>
        <form onSubmit={onSubmit} noValidate>
          <div className={styles.dRows}>{children}</div>
          {error && <p role="alert" className={styles.dError}>{error}</p>}
          <div className={styles.dActions} style={{ justifyContent: "flex-end" }}>
            <button type="button" className={`${styles.btn} ${styles.btnOutline}`} disabled={busy} onClick={onClose}>ยกเลิก</button>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy}>{busy ? "กำลังบันทึก…" : "บันทึก"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Standard opening rule (Figma 05a · แก้ไขเวลามาตรฐาน)
export function StandardDialog({ current, onClose, onSaved }: { current: Standard; onClose: () => void; onSaved: () => void }) {
  const [daysBefore, setDaysBefore] = useState(String(current.daysBefore));
  const [time, setTime] = useState(current.time);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLSelectElement>(null);
  useEffect(() => { first.current?.focus(); }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return setError("กรุณาเลือกเวลาเปิดรับจอง");
    setBusy(true); setError("");
    try {
      await adminApi("/admin/hours/standard", { method: "PUT", body: { daysBefore: Number(daysBefore), time } });
      onSaved();
    } catch (err) {
      const f = asFailure(err); setError(ERRORS[f.code] ?? f.message); setBusy(false);
    }
  }
  return (
    <Frame title="แก้ไขเวลามาตรฐาน" sub="กำหนดเวลาเปิดรับจองสำหรับทุกคืน" busy={busy} onClose={onClose} onSubmit={save} error={error}>
      <label className={styles.field} style={{ gridTemplateColumns: "1fr" }}><span className={styles.fieldLabel} style={{ color: "#25211f", fontWeight: 600 }}>เปิดรับจองล่วงหน้า</span>
        <select ref={first} className={styles.input} value={daysBefore} onChange={(e) => setDaysBefore(e.target.value)}>
          {Array.from({ length: 8 }, (_, n) => <option key={n} value={n}>{daysLabel(n)}</option>)}
        </select></label>
      <label className={styles.field} style={{ gridTemplateColumns: "1fr" }}><span className={styles.fieldLabel} style={{ color: "#25211f", fontWeight: 600 }}>เวลาเปิดรับจอง</span>
        <input className={styles.input} type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
      <p className={styles.hintLine}>ใช้กับทุกคืนที่ไม่ได้กำหนดเวลาเฉพาะ</p>
    </Frame>
  );
}

// Special day (Figma 05b · เพิ่มวันพิเศษ)
export function SpecialDayDialog({ today, onClose, onSaved }: { today: string; onClose: () => void; onSaved: () => void }) {
  const [serviceDate, setServiceDate] = useState("");
  const [opensOn, setOpensOn] = useState("");
  const [time, setTime] = useState("20:00");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!serviceDate) return setError("กรุณาเลือกคืนที่ต้องการ");
    if (!opensOn) return setError("กรุณาเลือกวันเปิดรับจอง");
    if (opensOn > serviceDate) return setError("วันเปิดรับจองต้องไม่เกินคืนที่จอง");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return setError("กรุณาเลือกเวลาเปิดรับจอง");
    setBusy(true); setError("");
    try {
      await adminApi("/admin/hours/special", { method: "POST", body: { serviceDate, opensOn, time } });
      onSaved();
    } catch (err) {
      const f = asFailure(err); setError(ERRORS[f.code] ?? f.message); setBusy(false);
    }
  }
  const label = { color: "#25211f", fontWeight: 600 } as const;
  return (
    <Frame title="เพิ่มวันพิเศษ" sub="กำหนดเวลาเปิดจองเฉพาะคืนที่เลือก" busy={busy} onClose={onClose} onSubmit={save} error={error}>
      <label className={styles.field} style={{ gridTemplateColumns: "1fr" }}><span className={styles.fieldLabel} style={label}>คืนที่ต้องการ</span>
        <input ref={first} className={styles.input} type="date" min={today} value={serviceDate}
          onChange={(e) => { setServiceDate(e.target.value); if (!opensOn && e.target.value) setOpensOn(e.target.value); }} /></label>
      <label className={styles.field} style={{ gridTemplateColumns: "1fr" }}><span className={styles.fieldLabel} style={label}>วันเปิดรับจอง</span>
        <input className={styles.input} type="date" min={today} max={serviceDate || undefined} value={opensOn} onChange={(e) => setOpensOn(e.target.value)} /></label>
      <label className={styles.field} style={{ gridTemplateColumns: "1fr" }}><span className={styles.fieldLabel} style={label}>เวลาเปิดรับจอง</span>
        <input className={styles.input} type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
    </Frame>
  );
}
