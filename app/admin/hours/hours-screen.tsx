"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "../admin-shell";
import { SpecialDayDialog, StandardDialog, type Standard } from "../hours-dialogs";
import { adminApi, asFailure, shortThaiDate, type Staff } from "../admin-api";
import styles from "../admin.module.css";

type Special = { id: string; serviceDate: string; opensOn: string; time: string };
type Hours = { standard: Standard; specials: Special[]; canEdit: boolean };

const thaiTime = (t: string) => `${t} น.`;

// Staff opening hours (Figma "Admin · 05 · เวลาเปิดจอง", node 131:474, dialogs 05a / 05b)
export default function HoursScreen() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff>();
  const [hours, setHours] = useState<Hours>();
  const [today, setToday] = useState("");
  const [dialog, setDialog] = useState<"standard" | "special" | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => adminApi<Hours>("/admin/hours").then((r) => { setHours(r); setError(""); })
    .catch((e) => { if (asFailure(e).status === 401) router.replace("/admin/login"); else setError(asFailure(e).message); }), [router]);

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

  return (
    <AdminShell active="/admin/hours" staff={staff}>
      <h1 className={styles.h1}>เวลาเปิดจอง</h1>
      <p className={styles.sub}>กำหนดเวลาเปิดรับจองมาตรฐาน และตั้งเวลาเฉพาะสำหรับวันพิเศษ</p>
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {hours && !hours.canEdit && <p className={styles.readOnly}>เฉพาะเจ้าของร้านที่แก้ไขเวลาเปิดจองได้</p>}

      <section className={styles.card} style={{ marginTop: 32 }} aria-labelledby="std-title">
        <div className={styles.cardHead}>
          <div>
            <h2 id="std-title" className={styles.cardTitle}>เวลาเปิดรับจองมาตรฐาน</h2>
            <p className={styles.cardSub}>ใช้กับทุกคืนที่ไม่มีการตั้งค่าเฉพาะ</p>
          </div>
          {hours?.canEdit && <button type="button" className={styles.editLink} onClick={() => setDialog("standard")}>แก้ไขค่าเริ่มต้น</button>}
        </div>
        <p className={styles.ruleText}>{std ? `ทุกคืน · ${std.daysBefore === 0 ? "เปิดจองในคืนที่จอง" : `เปิดจองล่วงหน้า ${std.daysBefore} วัน`} · เวลา ${thaiTime(std.time)}` : "กำลังโหลด…"}</p>
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
            <span className={styles.gridValue}>{shortThaiDate(s.serviceDate)}</span>
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
    </AdminShell>
  );
}
