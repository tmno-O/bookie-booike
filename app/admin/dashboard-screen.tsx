"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import AddBookingDialog from "./add-booking-dialog";
import BookingDetailsDialog from "./booking-details-dialog";
import { AdminShell } from "./admin-shell";
import {
  adminApi, asFailure, CHANNEL_LABEL, formatPhone, PARTY_LABEL, shortThaiDate, STATUS_LABEL, type Staff,
} from "./admin-api";
import styles from "./admin.module.css";

type Status = keyof typeof STATUS_LABEL;
type Row = { id: string; reference: string; name: string; phone: string; party: string; zoneName: string; channel: "line" | "staff"; status: Status };
type Dashboard = {
  serviceDate: string;
  today: string;
  metrics: { bookings: number; guests: number; pendingRequests: number; checkedIn: number };
  bookings: Row[];
  zones: { id: string; name: string; seats: number; booked: number }[];
};

const FILTERS: { key: "all" | Status; label: string }[] = [
  { key: "all", label: "ทั้งหมด" }, { key: "pending", label: "รอจัดสรร" },
  { key: "confirmed", label: "ยืนยันแล้ว" }, { key: "checked_in", label: "เช็กอินแล้ว" },
];

// Staff dashboard (Figma "Admin · 01 · ภาพรวมร้านค้า", node 128:3)
export default function DashboardScreen({ addBooking = false, bookingId }: { addBooking?: boolean; bookingId?: string }) {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff>();
  const [date, setDate] = useState<string>();
  const [data, setData] = useState<Dashboard>();
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    adminApi<{ staff: Staff }>("/admin/me").then((r) => active && setStaff(r.staff))
      .catch((e) => active && (asFailure(e).status === 401 ? router.replace("/admin/login") : setError(asFailure(e).message)));
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    let active = true;
    const load = () => adminApi<Dashboard>(`/admin/dashboard${date ? `?date=${date}` : ""}`).then((r) => {
      if (!active) return;
      setData(r); setError("");
      setDate((d) => d ?? r.serviceDate);
    }).catch((e) => {
      if (!active) return;
      if (asFailure(e).status === 401) router.replace("/admin/login"); else setError(asFailure(e).message);
    });
    void load();
    const timer = setInterval(load, 5000); // pick up new customer bookings
    return () => { active = false; clearInterval(timer); };
  }, [date, router]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s/g, "");
    return (data?.bookings ?? []).filter((b) => (filter === "all" || b.status === filter)
      && (!q || b.name.toLowerCase().includes(q) || b.phone.includes(q)));
  }, [data, filter, query]);

  const m = data?.metrics;
  const metrics = [
    { label: "การจองคืนนี้", value: m?.bookings, unit: "รายการ" },
    { label: "จำนวนลูกค้า", value: m?.guests, unit: "คน" },
    { label: "รอจัดสรร", value: m?.pendingRequests, unit: "คำขอ" },
    { label: "เข้าใช้บริการแล้ว", value: m?.checkedIn, unit: "รายการ" },
  ];

  return (
    <AdminShell active="/admin" staff={staff}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.h1}>ภาพรวม</h1>
          <p className={styles.sub}>ติดตามการจองและคิวของร้านในคืนนี้</p>
        </div>
        <div className={styles.actions}>
          <label className={styles.dateField}>
            <span>{date ? shortThaiDate(date) : "กำลังโหลด…"}</span>
            <input type="date" aria-label="เลือกคืนบริการ" className={styles.dateInput} value={date ?? ""}
              onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
          <Link href="/admin/bookings/new" className={styles.primary}>+ เพิ่มการจอง</Link>
        </div>
      </div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <hr className={styles.divider} />

      <section className={styles.metrics} aria-label="สรุปคืนนี้">
        {metrics.map((x) => (
          <div key={x.label} className={styles.metric}>
            <p className={styles.metricLabel}>{x.label}</p>
            <p className={styles.metricValue}>{x.value ?? "–"}<span className={styles.unit}>{x.unit}</span></p>
          </div>
        ))}
      </section>
      <hr className={styles.divider} />

      <h2 className={styles.h2}>รายการจองคืนนี้</h2>
      <p className={styles.sub} style={{ marginTop: 8, fontSize: 13 }}>ตรวจสอบสถานะและจัดการการจอง</p>
      <div className={styles.toolbar}>
        <div className={styles.chips} role="group" aria-label="กรองตามสถานะ">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" aria-pressed={filter === f.key}
              className={`${styles.chip} ${filter === f.key ? styles.chipOn : ""}`} onClick={() => setFilter(f.key)}>{f.label}</button>
          ))}
        </div>
        <input type="search" className={styles.search} placeholder="ค้นหาชื่อ หรือเบอร์โทร" aria-label="ค้นหาชื่อ หรือเบอร์โทร"
          value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>ลูกค้า</th><th>จำนวน</th><th>โซน</th><th>ช่องทาง</th><th>สถานะ</th><th><span style={{ visibility: "hidden" }}>การดำเนินการ</span></th></tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td><div className={styles.cname}>{b.name}</div><div className={styles.cphone}>{formatPhone(b.phone)}</div></td>
                <td>{PARTY_LABEL[b.party]}</td>
                <td>{b.zoneName}</td>
                <td className={styles.muted}>{CHANNEL_LABEL[b.channel]}</td>
                <td><span className={`${styles.s} ${b.status === "pending" ? styles.sOrange : styles.sGreen}`}>{STATUS_LABEL[b.status]}</span></td>
                <td style={{ textAlign: "right" }}><Link href={`/admin/bookings/${b.id}`} className={styles.rowLink}>ดูรายละเอียด ›</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && rows.length === 0 && <p className={styles.empty}>{data.bookings.length ? "ไม่พบรายการที่ตรงกับตัวกรอง" : "ยังไม่มีการจองในคืนนี้"}</p>}
      </div>

      <div className={styles.zonesHead}>
        <div>
          <h2 className={styles.h2}>โซนคืนนี้</h2>
          <p className={styles.sub} style={{ marginTop: 8, fontSize: 13 }}>ความจุที่ร้านกำหนดและจำนวนที่จองแล้ว</p>
        </div>
        <Link href="/admin/zones" className={styles.more}>จัดการโซน ›</Link>
      </div>
      <div className={styles.zones}>
        {data?.zones.map((z) => (
          <div key={z.id} className={styles.zone}>
            <p className={styles.zoneName}>{z.name}</p>
            <div className={styles.zoneRow}><span>จองแล้ว</span><span className={styles.zoneCount}>{z.booked} / {z.seats} คน</span></div>
            <div className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={z.seats} aria-valuenow={Math.min(z.booked, z.seats)} aria-label={`${z.name} จองแล้ว`}>
              <div className={styles.barFill} style={{ width: `${Math.min(100, (z.booked / z.seats) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
      {bookingId && <BookingDetailsDialog bookingId={bookingId} onClose={() => router.push("/admin")} />}
      {addBooking && date && <AddBookingDialog today={data?.today ?? date} onClose={() => router.push("/admin")} />}
    </AdminShell>
  );
}
