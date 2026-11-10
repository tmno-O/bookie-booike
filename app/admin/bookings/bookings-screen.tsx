"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminShell } from "../admin-shell";
import BookingDetailsDialog from "../booking-details-dialog";
import {
  adminApi, asFailure, CHANNEL_LABEL, formatPhone, PARTY_LABEL, queueDate, STATUS_LABEL, type Staff,
} from "../admin-api";
import styles from "../admin.module.css";

type Status = keyof typeof STATUS_LABEL;
type Row = {
  id: string; reference: string; name: string; phone: string; serviceDate: string; party: string; zoneId: string;
  zoneName: string; channel: keyof typeof CHANNEL_LABEL; status: Status;
};
type Zone = { id: string; name: string };

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// Staff booking list (Figma "Admin · 02 · รายการจอง", node 131:2)
export default function BookingsListScreen({ initialDate, bookingId }: { initialDate?: string; bookingId?: string }) {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff>();
  const [date, setDate] = useState(initialDate ?? "");
  const [status, setStatus] = useState("");
  const [zone, setZone] = useState("");
  const [query, setQuery] = useState("");
  const [zones, setZones] = useState<Zone[]>([]);
  const [rows, setRows] = useState<Row[]>();
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    adminApi<{ staff: Staff }>("/admin/me").then((r) => active && setStaff(r.staff))
      .catch((e) => active && asFailure(e).status === 401 && router.replace("/admin/login"));
    adminApi<{ zones: Zone[] }>("/admin/zones").then((r) => active && setZones(r.zones)).catch(() => undefined);
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    if (status) params.set("status", status);
    if (zone) params.set("zone", zone);
    if (query.trim()) params.set("q", query.trim());
    const load = () => adminApi<{ serviceDate: string; bookings: Row[] }>(`/admin/bookings?${params}`).then((r) => {
      if (!active) return;
      setRows(r.bookings); setError(""); setDate((d) => d || r.serviceDate);
    }).catch((e) => {
      if (!active) return;
      if (asFailure(e).status === 401) router.replace("/admin/login"); else setError(asFailure(e).message);
    });
    const first = setTimeout(() => void load(), query ? 250 : 0); // small debounce while typing
    const timer = setInterval(() => void load(), 5000);
    return () => { active = false; clearTimeout(first); clearInterval(timer); };
  }, [date, status, zone, query, router]);

  const detailsHref = (id: string) => `/admin/bookings/${id}?from=list&date=${date}`;

  return (
    <AdminShell active="/admin/bookings" staff={staff}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.h1}>รายการจอง</h1>
          <p className={styles.sub}>ค้นหาและจัดการการจองของร้าน</p>
        </div>
        <div className={styles.actions}>
          <Link href="/admin/bookings/new" className={styles.primary}>+ เพิ่มการจอง</Link>
        </div>
      </div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <hr className={styles.divider} style={{ marginBottom: 0 }} />

      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <div className={styles.stepper}>
            <button type="button" className={styles.stepBtn} aria-label="คืนก่อนหน้า" disabled={!date} onClick={() => setDate(addDays(date, -1))}>‹</button>
            <label className={styles.stepDate}>
              <span>{date ? queueDate(date) : "…"}</span>
              <input type="date" aria-label="เลือกคืนที่จอง" className={styles.dateInput} value={date}
                onChange={(e) => e.target.value && setDate(e.target.value)} />
            </label>
            <button type="button" className={styles.stepBtn} aria-label="คืนถัดไป" disabled={!date} onClick={() => setDate(addDays(date, 1))}>›</button>
          </div>
          <select className={styles.select} aria-label="กรองตามสถานะ" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">ทุกสถานะ</option>
            {(Object.keys(STATUS_LABEL) as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <select className={styles.select} aria-label="กรองตามโซน" value={zone} onChange={(e) => setZone(e.target.value)}>
            <option value="">ทุกโซน</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </div>
        <input type="search" className={styles.searchWide} placeholder="ค้นหาชื่อ เบอร์ หรือเลขจอง" aria-label="ค้นหาชื่อ เบอร์ หรือเลขจอง"
          value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <h2 className={styles.h2} style={{ fontSize: 16, margin: "28px 0 16px" }} aria-live="polite">การจอง {rows ? rows.length : "–"} รายการ</h2>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>ลูกค้า</th><th>คืนที่จอง</th><th>จำนวน</th><th>โซน</th><th>ช่องทาง</th><th>สถานะ</th><th><span style={{ visibility: "hidden" }}>การดำเนินการ</span></th></tr></thead>
          <tbody>
            {rows?.map((b) => (
              <tr key={b.id}>
                <td><div className={styles.cname}>{b.name}</div><div className={styles.cphone}>{formatPhone(b.phone)} · {b.reference}</div></td>
                <td>{queueDate(b.serviceDate)}</td>
                <td>{PARTY_LABEL[b.party]}</td>
                <td>{b.zoneName}</td>
                <td>{CHANNEL_LABEL[b.channel]}</td>
                <td><span className={`${styles.s} ${b.status === "pending" ? styles.sOrange : b.status === "confirmed" ? styles.sGreen : ""}`}>{STATUS_LABEL[b.status]}</span></td>
                <td style={{ textAlign: "right" }}><Link href={detailsHref(b.id)} className={styles.rowLink} style={{ color: "#25211f" }}>ดูรายละเอียด ›</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows?.length === 0 && <p className={styles.empty}>ไม่พบการจองที่ตรงกับตัวกรอง</p>}
      </div>
      {bookingId && <BookingDetailsDialog bookingId={bookingId} onClose={() => router.push(`/admin/bookings${date ? `?date=${date}` : ""}`)} />}
    </AdminShell>
  );
}
