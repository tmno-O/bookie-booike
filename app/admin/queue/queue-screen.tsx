"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AdminShell } from "../admin-shell";
import RequestDialog from "../request-dialog";
import { adminApi, asFailure, clockTime, PARTY_LABEL, queueDate, type Staff } from "../admin-api";
import styles from "../admin.module.css";

type Row = {
  id: string; queueNo: number; requestedAt: string; name: string; party: string; zoneName: string; status: "pending" | "allocated";
};
type Data = { serviceDate: string; pending: number; requests: Row[] };
const FILTERS = [{ key: "all", label: "ทั้งหมด" }, { key: "pending", label: "รอจัดสรร" }, { key: "allocated", label: "จัดสรรแล้ว" }] as const;

// Staff booking queue (Figma "Admin · 03 · คิวการจอง", node 131:175)
export default function QueueScreen({ requestId }: { requestId?: string }) {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff>();
  const [date, setDate] = useState<string>();
  const [data, setData] = useState<Data>();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    adminApi<{ staff: Staff }>("/admin/me").then((r) => active && setStaff(r.staff))
      .catch((e) => active && (asFailure(e).status === 401 ? router.replace("/admin/login") : setError(asFailure(e).message)));
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    let active = true;
    const load = () => adminApi<Data>(`/admin/queue${date ? `?date=${date}` : ""}`).then((r) => {
      if (!active) return;
      setData(r); setError(""); setDate((d) => d ?? r.serviceDate);
    }).catch((e) => {
      if (!active) return;
      if (asFailure(e).status === 401) router.replace("/admin/login"); else setError(asFailure(e).message);
    });
    void load();
    const timer = setInterval(load, 5000); // new customer requests arrive while the page is open
    return () => { active = false; clearInterval(timer); };
  }, [date, router]);

  const rows = useMemo(() => (data?.requests ?? []).filter((r) => filter === "all" || r.status === filter), [data, filter]);

  return (
    <AdminShell active="/admin/queue" staff={staff}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.h1}>คิวการจอง</h1>
          <p className={styles.sub}>ตรวจสอบคำขอตามลำดับที่ส่งเข้ามาหลังเปิดจอง</p>
        </div>
        <div className={styles.actions}>
          <label className={styles.dateField} style={{ height: 36 }}>
            <span>{date ? `คืน ${queueDate(date)}` : "กำลังโหลด…"}</span>
            <input type="date" aria-label="เลือกคืนบริการ" className={styles.dateInput} value={date ?? ""}
              onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
        </div>
      </div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <hr className={styles.divider} />

      <h2 className={styles.h2}>คำขอที่รอจัดสรร</h2>
      <p className={styles.sub} style={{ marginTop: 8, fontSize: 13 }}>{data ? data.pending : "–"} คำขอ</p>
      <div className={styles.toolbar}>
        <div className={styles.chips} role="group" aria-label="กรองตามสถานะ">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" aria-pressed={filter === f.key}
              className={`${styles.chip} ${filter === f.key ? styles.chipOn : ""}`} onClick={() => setFilter(f.key)}>{f.label}</button>
          ))}
        </div>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>ลำดับ</th><th>เวลาส่งคำขอ</th><th>ลูกค้า</th><th>จำนวน</th><th>โซน</th><th>สถานะ</th><th><span style={{ visibility: "hidden" }}>การดำเนินการ</span></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={styles.cname}>#{r.queueNo}</td>
                <td>{clockTime(r.requestedAt)}</td>
                <td>{r.name}</td>
                <td>{PARTY_LABEL[r.party]}</td>
                <td>{r.zoneName}</td>
                <td><span className={`${styles.s} ${r.status === "pending" ? styles.sOrange : styles.sGreen}`}>{r.status === "pending" ? "รอจัดสรร" : "จัดสรรแล้ว"}</span></td>
                <td style={{ textAlign: "right" }}><Link href={`/admin/queue/${r.id}`} className={styles.rowLink} style={{ color: "#25211f" }}>ดูรายละเอียด ›</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && rows.length === 0 && <p className={styles.empty}>{data.requests.length ? "ไม่พบรายการที่ตรงกับตัวกรอง" : "ยังไม่มีคำขอในคืนนี้"}</p>}
      </div>
      <p className={styles.muted} style={{ marginTop: 26 }}>ลำดับคิวเริ่มเมื่อคำขอถูกส่งเข้าสู่ระบบหลังเปิดจอง</p>
      {requestId && <RequestDialog requestId={requestId} onClose={() => router.push("/admin/queue")} />}
    </AdminShell>
  );
}
