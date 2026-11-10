"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { adminApi, asFailure, CHANNEL_LABEL, PARTY_LABEL, shortThaiDate, STATUS_LABEL } from "./admin-api";
import styles from "./admin.module.css";

type Zone = { id: string; name: string; available: boolean; closed?: boolean };
type Created = { reference: string; name: string; status: keyof typeof STATUS_LABEL; channel: keyof typeof CHANNEL_LABEL };

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// Staff-assisted booking in three steps: fill in → review → created.
export default function AddBookingDialog({ today, maxAdvanceDays = 6, onClose }: {
  today: string; maxAdvanceDays?: number; onClose: () => void;
}) {
  const [step, setStep] = useState<"form" | "review" | "done">("form");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState(today);
  const [party, setParty] = useState("1-4");
  const [zoneId, setZoneId] = useState("");
  const [zones, setZones] = useState<Zone[]>([]);
  const [created, setCreated] = useState<Created>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => { first.current?.focus(); }, [step]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  useEffect(() => {
    let active = true;
    adminApi<{ zones: Zone[] }>(`/availability?date=${date}`).then((r) => {
      if (!active) return;
      setZones(r.zones);
      setZoneId((current) => (r.zones.find((z) => z.id === current)?.available ? current : r.zones.find((z) => z.available)?.id ?? ""));
    }).catch((e) => active && setError(asFailure(e).message));
    return () => { active = false; };
  }, [date]);

  const zoneName = zones.find((z) => z.id === zoneId)?.name ?? "";

  function review(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError("กรุณากรอกชื่อลูกค้า");
    if (!/^0\d{8,9}$/.test(phone.trim())) return setError("เบอร์โทรต้องเป็นตัวเลข 9–10 หลัก ขึ้นต้นด้วย 0");
    if (!zoneId) return setError("ไม่มีโซนว่างในคืนนี้ กรุณาเลือกคืนอื่น");
    setError(""); setStep("review");
  }

  async function confirm() {
    setBusy(true); setError("");
    try {
      const r = await adminApi<{ booking: Created }>("/admin/bookings", {
        method: "POST", body: { name: name.trim(), phone: phone.trim(), serviceDate: date, party, zoneId },
      });
      setCreated(r.booking); setStep("done");
    } catch (e) {
      const f = asFailure(e);
      setError(f.code === "ZONE_FULL" ? "โซนนี้เต็มแล้ว กรุณากลับไปเลือกโซนอื่น" : f.message);
    } finally { setBusy(false); }
  }

  function another() {
    setName(""); setPhone(""); setCreated(undefined); setError(""); setStep("form");
    void adminApi<{ zones: Zone[] }>(`/availability?date=${date}`).then((r) => setZones(r.zones)).catch(() => undefined);
  }

  const title = step === "form" ? "เพิ่มการจอง" : step === "review" ? "ตรวจสอบการจอง" : "สร้างการจองแล้ว";
  const sub = step === "form" ? "กรอกข้อมูลลูกค้าที่จองกับร้านโดยตรง" : step === "review" ? "ตรวจสอบข้อมูลก่อนยืนยัน" : "บันทึกการจองเรียบร้อย";
  const row = (label: string, value: string) => (
    <div className={styles.dRow} key={label}><span className={styles.dLabel}>{label}</span><p className={styles.dValue}>{value}</p></div>
  );

  return (
    <div className={styles.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="add-booking-title">
        <h2 id="add-booking-title" className={styles.dialogTitle}>{title}</h2>
        <p className={styles.dialogSub}>{sub}</p>

        {step === "form" && (
          <form onSubmit={review} noValidate>
            <div className={styles.dRows}>
              <label className={styles.field}><span className={styles.fieldLabel}>ชื่อลูกค้า</span>
                <input ref={first} className={styles.input} value={name} maxLength={80} autoComplete="off" onChange={(e) => setName(e.target.value)} /></label>
              <label className={styles.field}><span className={styles.fieldLabel}>เบอร์โทร</span>
                <input className={styles.input} value={phone} type="tel" inputMode="tel" autoComplete="off" onChange={(e) => setPhone(e.target.value)} /></label>
              <label className={styles.field}><span className={styles.fieldLabel}>คืนที่จอง</span>
                <input className={styles.input} type="date" value={date} min={today} max={addDays(today, maxAdvanceDays)}
                  onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
              <label className={styles.field}><span className={styles.fieldLabel}>จำนวน</span>
                <select className={styles.input} value={party} onChange={(e) => setParty(e.target.value)}>
                  {Object.entries(PARTY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select></label>
              <label className={styles.field}><span className={styles.fieldLabel}>โซน</span>
                <select className={styles.input} value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                  {zones.map((z) => <option key={z.id} value={z.id} disabled={!z.available}>{z.name}{z.available ? "" : z.closed ? " (ปิด)" : " (เต็ม)"}</option>)}
                </select></label>
            </div>
            {error && <p role="alert" className={styles.dError}>{error}</p>}
            <div className={styles.dActions}>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose}>กลับ</button>
              <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>ตรวจสอบข้อมูล</button>
            </div>
          </form>
        )}

        {step === "review" && (
          <>
            <div className={styles.dRows}>
              {row("ชื่อลูกค้า", name.trim())}
              {row("เบอร์โทร", phone.trim())}
              {row("คืน / จำนวน", `${shortThaiDate(date)} · ${PARTY_LABEL[party]}`)}
              {row("โซน", zoneName)}
            </div>
            {error && <p role="alert" className={styles.dError}>{error}</p>}
            <div className={styles.dActions}>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} disabled={busy} onClick={() => { setError(""); setStep("form"); }}>กลับ</button>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={confirm}>{busy ? "กำลังบันทึก…" : "ยืนยันการจอง"}</button>
            </div>
          </>
        )}

        {step === "done" && created && (
          <>
            <div className={styles.dRows}>
              {row("ลูกค้า", created.name)}
              {row("เลขอ้างอิง", created.reference)}
              {row("ช่องทาง", CHANNEL_LABEL[created.channel])}
              {row("สถานะ", STATUS_LABEL[created.status])}
            </div>
            <div className={styles.dActions}>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={another}>เพิ่มอีกรายการ</button>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onClose}>กลับไปยังรายการ</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
