"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "../admin-shell";
import { ClosureDialog, SpecialDayDialog, StandardDialog, type Standard } from "../hours-dialogs";
import { adminApi, asFailure, shortThaiDate, type Staff } from "../admin-api";
import styles from "../admin.module.css";

type Special = { id: string; serviceDate: string; opensOn: string; time: string; title: string; recipients: number; sent: number; failed: number };
type Hours = { standard: Standard; specials: Special[]; canEdit: boolean; openWeekdays: number[];
  closures: { serviceDate: string; reason: string; affectedBookings: number }[] };

const thaiTime = (t: string) => `${t} น.`;

// Staff opening hours (Figma "Admin · 05 · เวลาเปิดจอง", node 131:474, dialogs 05a / 05b)
export default function HoursScreen() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff>();
  const [hours, setHours] = useState<Hours>();
  const [today, setToday] = useState("");
  const [dialog, setDialog] = useState<"standard" | "special" | "closure" | null>(null);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => adminApi<Hours>("/admin/hours").then((r) => { setHours(r); setWeekdays(r.openWeekdays); setError(""); })
    .catch((e) => {
      const failure = asFailure(e);
      if (failure.status === 401) router.replace("/admin/login");
      else setError(failure.code === "FORBIDDEN" ? "เฉพาะเจ้าของร้านที่จัดการเวลาเปิดจองได้" : failure.message);
    }), [router]);

  useEffect(() => {
    let active = true;
    adminApi<{ staff: Staff }>("/admin/me").then((r) => active && setStaff(r.staff))
      .catch((e) => active && asFailure(e).status === 401 && router.replace("/admin/login"));
    adminApi<{ today: string }>("/venue").then((r) => active && setToday(r.today)).catch(() => undefined);
    const first = setTimeout(() => void load(), 0);
    return () => { active = false; clearTimeout(first); };
  }, [load, router]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const saved = () => { setDialog(null); setNotice("บันทึกการตั้งค่าแล้ว"); void load(); };
  async function remove(id: string) {
    try { await adminApi(`/admin/hours/special/${id}`, { method: "DELETE" }); setNotice("ลบวันพิเศษแล้ว"); void load(); }
    catch (e) { setError(asFailure(e).message); }
  }
  const std = hours?.standard;
  async function saveWeekdays() {
    setBusy(true); setError("");
    try {
      const saved = await adminApi<{ affectedBookings?: number }>("/admin/hours/closures", { method: "PUT", body: { openWeekdays: weekdays } });
      setNotice(saved.affectedBookings
        ? `บันทึกวันเปิดร้านแล้ว มีการจอง ${saved.affectedBookings} รายการในวันที่ปิดใหม่ ใช้ "วันปิดพิเศษ" เพื่อยกเลิกและแจ้งลูกค้า หรือติดต่อผู้จอง`
        : "บันทึกวันเปิดร้านแล้ว");
      await load();
    }
    catch (e) { setError(asFailure(e).message); } finally { setBusy(false); }
  }
  async function removeClosure(date: string) {
    try { await adminApi(`/admin/hours/closures/${date}`, { method: "DELETE" }); setNotice("ลบวันปิดพิเศษแล้ว"); void load(); }
    catch (e) { setError(asFailure(e).message); }
  }

  return (
    <AdminShell active="/admin/hours" staff={staff}>
      <h1 className={styles.h1}>เวลาเปิดจอง</h1>
      <p className={styles.sub}>กำหนดเวลาเปิดรับจองมาตรฐาน และตั้งเวลาเฉพาะสำหรับวันพิเศษ</p>
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {hours && !hours.canEdit && <p className={styles.readOnly}>เฉพาะเจ้าของร้านที่แก้ไขเวลาเปิดจองได้</p>}

      {hours && <section className={styles.card} style={{ marginTop: 32 }} aria-labelledby="weekdays-title">
        <h2 id="weekdays-title" className={styles.cardTitle}>วันเปิดร้าน</h2>
        <div className={styles.actions} style={{ flexWrap: "wrap", marginBlock: 16 }}>
          {["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"].map((day, index) =>
            <label key={day} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44 }}>
              <input type="checkbox" checked={weekdays.includes(index)} disabled={!hours.canEdit || busy}
                onChange={(e) => setWeekdays((days) => e.target.checked ? [...days, index].sort() : days.filter((d) => d !== index))} />{day}
            </label>)}
        </div>
        {!weekdays.length && <p className={styles.hintLine}>ไม่เลือกวันใด = ปิดรับจองทุกวัน</p>}
        {hours.canEdit && <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={saveWeekdays}>{busy ? "กำลังบันทึก…" : "บันทึกวันเปิดร้าน"}</button>}
      </section>}
      <div className={styles.sectionHead}><h2 className={styles.h2}>วันปิดพิเศษ</h2>
        {hours?.canEdit && <button className={`${styles.btn} ${styles.btnOutline}`} onClick={() => setDialog("closure")}>+ เพิ่มวันปิด</button>}</div>
      <section className={styles.card} aria-label="วันปิดพิเศษ">
        {hours?.closures.length === 0 && <p className={styles.cardSub}>ยังไม่มีวันปิดพิเศษ</p>}
        {hours?.closures.map((c) => <div key={c.serviceDate} className={styles.cardHead}>
          <p>{shortThaiDate(c.serviceDate)} · {c.reason || "ร้านปิด"}<br /><small>รายการจองเดิม {c.affectedBookings} รายการ · ไม่ยกเลิกอัตโนมัติ</small></p>
          {hours.canEdit && <button className={styles.linkBtn} onClick={() => removeClosure(c.serviceDate)}>เปิดรับจองอีกครั้ง</button>}
        </div>)}
      </section>

      <section className={styles.card} style={{ marginTop: 32 }} aria-labelledby="std-title">
        <div className={styles.cardHead}>
          <div>
            <h2 id="std-title" className={styles.cardTitle}>เวลาเปิดรับจองมาตรฐาน</h2>
            <p className={styles.cardSub}>ใช้กับทุกคืนที่ไม่มีการตั้งค่าเฉพาะ</p>
          </div>
          {hours?.canEdit && <button type="button" className={styles.editLink} onClick={() => setDialog("standard")}>แก้ไขค่าเริ่มต้น</button>}
        </div>
        <p className={styles.ruleText}>{std ? `ทุกคืน · ${std.daysBefore === 0 ? "เปิดจองในคืนที่จอง" : `เปิดจองล่วงหน้า ${std.daysBefore} วัน`} · เวลา ${thaiTime(std.time)}` : error ? "–" : "กำลังโหลด…"}</p>
        <p className={styles.cardSub}>กำหนดเวลาเปิดรับจองล่วงหน้าก่อนคืนที่ลูกค้าต้องการ</p>
      </section>

      <div className={styles.sectionHead}>
        <h2 className={styles.h2}>วันพิเศษ</h2>
        {hours?.canEdit && <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setDialog("special")}>+ เพิ่มวันพิเศษ</button>}
      </div>
      <section className={styles.card} aria-label="วันพิเศษ">
        {hours && hours.specials.length === 0 && (
          <>
            <h3 className={styles.cardTitle} style={{ fontSize: 16 }}>ยังไม่มีวันพิเศษ</h3>
            <p className={styles.cardSub}>ยังไม่มีการกำหนดวันพิเศษ ทุกคืนจะใช้เวลาเปิดจองมาตรฐาน</p>
            <p className={styles.cardSub} style={{ marginTop: 14 }}>เพิ่มวันพิเศษเพื่อกำหนดเวลาเปิดจองที่แตกต่างจากเวลามาตรฐาน</p>
          </>
        )}
        {hours?.specials.map((s) => (
          <div key={s.id} className={styles.specialGrid}>
            <span className={styles.gridLabel}>คืนที่จอง</span><span className={styles.gridLabel}>วันเปิดรับจอง</span>
            <span className={styles.gridLabel}>เวลาเปิดรับจอง</span><span />
            <span className={styles.gridValue}>{shortThaiDate(s.serviceDate)}{s.title && <><br />{s.title}</>}
              {s.recipients > 0 && <><br /><small>ผู้รับ {s.recipients} · ส่งแล้ว {s.sent} · ล้มเหลว {s.failed}</small></>}</span>
            <span className={styles.gridValue}>{shortThaiDate(s.opensOn)}</span>
            <span className={styles.gridValue}>{thaiTime(s.time)}</span>
            {hours.canEdit
              ? <button type="button" className={styles.linkBtn} onClick={() => remove(s.id)} aria-label={`ลบวันพิเศษ ${shortThaiDate(s.serviceDate)}`}>ลบ</button>
              : <span />}
          </div>
        ))}
      </section>

      {dialog === "standard" && std && <StandardDialog current={std} onClose={() => setDialog(null)} onSaved={saved} />}
      {dialog === "special" && today && <SpecialDayDialog today={today} onClose={() => setDialog(null)} onSaved={saved} />}
      {dialog === "closure" && today && <ClosureDialog today={today} onClose={() => setDialog(null)} onSaved={saved} />}
    </AdminShell>
  );
}
