"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "../admin-shell";
import ZoneDialog, { type ZoneRow } from "../zone-dialog";
import { adminApi, asFailure, type Staff } from "../admin-api";
import styles from "../admin.module.css";

// Staff zones and capacity (Figma "Admin · 04 · โซนและความจุ", node 131:332)
export default function ZonesScreen() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff>();
  const [zones, setZones] = useState<ZoneRow[]>();
  const [dialog, setDialog] = useState<{ zone?: ZoneRow } | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => adminApi<{ zones: ZoneRow[] }>("/admin/zones").then((r) => { setZones(r.zones); setError(""); })
    .catch((e) => { if (asFailure(e).status === 401) router.replace("/admin/login"); else setError(asFailure(e).message); }), [router]);

  useEffect(() => {
    let active = true;
    adminApi<{ staff: Staff }>("/admin/me").then((r) => active && setStaff(r.staff))
      .catch((e) => active && asFailure(e).status === 401 && router.replace("/admin/login"));
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 5000);
    return () => { active = false; clearTimeout(first); clearInterval(timer); };
  }, [load, router]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  return (
    <AdminShell active="/admin/zones" staff={staff}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.h1}>โซนและความจุ</h1>
          <p className={styles.sub}>กำหนดโซนและความจุที่เปิดรับจอง</p>
        </div>
        <div className={styles.actions}>
          <Link href="/admin/zones/plan" className={`${styles.btn} ${styles.btnOutline}`}>จัดการผังร้าน</Link>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setDialog({})}>+ เพิ่มโซน</button>
        </div>
      </div>
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <hr className={styles.divider} />

      <h2 className={styles.h2}>โซนของร้าน</h2>
      <p className={styles.sub} style={{ marginTop: 8, fontSize: 13 }}>ความจุและสถานะสำหรับคืนนี้</p>
      <div className={styles.tableWrap} style={{ marginTop: 24 }}>
        <table className={styles.table}>
          <thead><tr><th>โซน</th><th>ความจุ</th><th>จองแล้วคืนนี้</th><th>สถานะ</th><th><span style={{ visibility: "hidden" }}>การดำเนินการ</span></th></tr></thead>
          <tbody>
            {zones?.map((z) => (
              <tr key={z.id}>
                <td className={styles.cname}>{z.name}</td>
                <td>{z.seats} คน</td>
                <td>{z.bookedSeats} คน</td>
                <td><span className={`${styles.s} ${z.status === "open" ? styles.sGreen : styles.sMuted}`}>{z.status === "open" ? "เปิดรับจอง" : "ปิดรับจอง"}</span></td>
                <td style={{ textAlign: "right" }}>
                  <button type="button" className={styles.linkBtn} onClick={() => setDialog({ zone: z })} aria-label={`แก้ไขโซน ${z.name}`}>แก้ไข ›</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {zones?.length === 0 && <p className={styles.empty}>ยังไม่มีโซน</p>}
      </div>

      {dialog && (
        <ZoneDialog zone={dialog.zone} onClose={() => setDialog(null)}
          onSaved={(message) => { setDialog(null); setNotice(message); void load(); }} />
      )}
    </AdminShell>
  );
}
