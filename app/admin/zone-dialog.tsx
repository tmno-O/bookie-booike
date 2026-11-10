"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { adminApi, asFailure } from "./admin-api";
import styles from "./admin.module.css";

export type ZoneRow = {
  id: string; name: string; seats: number; status: "open" | "closed"; tables: number; tablesUsed: number; bookedSeats: number;
};

const ERRORS: Record<string, string> = {
  ZONE_NAME_TAKEN: "มีโซนชื่อนี้อยู่แล้ว",
  CAPACITY_BELOW_BOOKED: "ความจุน้อยกว่าจำนวนที่จองไว้แล้วในบางคืน",
};

// Add or edit a zone (Figma: เพิ่มโซน / แก้ไขโซน · <name>).
export default function ZoneDialog({ zone, onClose, onSaved }: {
  zone?: ZoneRow; onClose: () => void; onSaved: (message: string) => void;
}) {
  const [name, setName] = useState(zone?.name ?? "");
  const [seats, setSeats] = useState(String(zone?.seats ?? 24));
  const [status, setStatus] = useState<"open" | "closed">(zone?.status ?? "open");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const capacity = Number(seats);
    if (!name.trim()) return setError("กรุณากรอกชื่อโซน");
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) return setError("ความจุต้องเป็นจำนวนเต็ม 1–1000 คน");
    setBusy(true); setError("");
    try {
      const body = { name: name.trim(), seats: capacity, status };
      const r = zone
        ? await adminApi<{ zone: ZoneRow }>(`/admin/zones/${zone.id}`, { method: "PATCH", body })
        : await adminApi<{ zone: ZoneRow }>("/admin/zones", { method: "POST", body });
      onSaved(zone ? `บันทึกข้อมูลโซน ${r.zone.name} แล้ว` : `เพิ่มโซน ${r.zone.name} แล้ว`);
    } catch (e) {
      const f = asFailure(e);
      setError(ERRORS[f.code] ?? f.message); setBusy(false);
    }
  }

  return (
    <div className={styles.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="zone-title">
        <h2 id="zone-title" className={styles.dialogTitle}>{zone ? `แก้ไขโซน · ${zone.name}` : "เพิ่มโซน"}</h2>
        <p className={styles.dialogSub}>{zone ? "ความจุและสถานะการเปิดรับจอง" : "เพิ่มพื้นที่รับจองของร้าน"}</p>
        <form onSubmit={save} noValidate>
          <div className={styles.dRows}>
            <label className={styles.field}><span className={styles.fieldLabel}>ชื่อโซน</span>
              <input ref={first} className={styles.input} value={name} maxLength={40} autoComplete="off" onChange={(e) => setName(e.target.value)} /></label>
            <label className={styles.field}><span className={styles.fieldLabel}>ความจุ (คน)</span>
              <input className={styles.input} type="number" min={1} max={1000} inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} /></label>
            <label className={styles.field}><span className={styles.fieldLabel}>สถานะ</span>
              <select className={styles.input} value={status} onChange={(e) => setStatus(e.target.value as "open" | "closed")}>
                <option value="open">เปิดรับจอง</option><option value="closed">ปิดรับจอง</option>
              </select></label>
          </div>
          {error && <p role="alert" className={styles.dError}>{error}</p>}
          <div className={styles.dActions}>
            <button type="button" className={`${styles.btn} ${styles.btnGhost}`} disabled={busy} onClick={onClose}>กลับ</button>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy}>{busy ? "กำลังบันทึก…" : "บันทึก"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
