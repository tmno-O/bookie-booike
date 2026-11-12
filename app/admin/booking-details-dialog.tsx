"use client";

import { useEffect, useState } from "react";
import {
  adminApi, asFailure, CHANNEL_LABEL, formatPhone, PARTY_LABEL, shortThaiDate, STATUS_LABEL,
} from "./admin-api";
import styles from "./admin.module.css";

type Detail = {
  id: string; reference: string; name: string; phone: string; serviceDate: string; party: string; zoneName: string;
  channel: keyof typeof CHANNEL_LABEL; status: keyof typeof STATUS_LABEL; canCheckIn: boolean;
};

// Booking details with check-in (Figma: รายละเอียดการจอง → เช็กอินเรียบร้อย).
export default function BookingDetailsDialog({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const [booking, setBooking] = useState<Detail>();
  const [view, setView] = useState<"details" | "checked">("details");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  useEffect(() => {
    let active = true;
    adminApi<{ booking: Detail }>(`/admin/bookings/${bookingId}`).then((r) => active && setBooking(r.booking))
      .catch((e) => active && setError(asFailure(e).status === 404 ? "ไม่พบการจองนี้" : asFailure(e).message));
    return () => { active = false; };
  }, [bookingId]);

  async function checkIn() {
    setBusy(true); setError("");
    try {
      const r = await adminApi<{ booking: Detail }>(`/admin/bookings/${bookingId}/check-in`, { method: "POST" });
      setBooking(r.booking); setView("checked");
    } catch (e) {
      setError(asFailure(e).message);
    } finally { setBusy(false); }
  }

  const row = (label: string, value: string) => (
    <div className={styles.dRow} key={label}><span className={styles.dLabel}>{label}</span><p className={styles.dValue}>{value}</p></div>
  );
  const checked = view === "checked";
  const title = checked ? "เช็กอินเรียบร้อย" : booking ? `รายละเอียดการจอง · ${booking.name}` : "รายละเอียดการจอง";
  const sub = checked ? "สถานะการจองได้รับการปรับปรุง" : "ข้อมูลการจองและการเข้ารับบริการ";

  return (
    <div className={styles.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="booking-details-title">
        <h2 id="booking-details-title" className={styles.dialogTitle}>{title}</h2>
        <p className={styles.dialogSub}>{sub}</p>

        {!booking && !error && <p className={styles.dialogSub} style={{ marginTop: 28 }}>กำลังโหลด…</p>}
        {booking && !checked && (
          <div className={styles.dRows}>
            {row("ลูกค้า", booking.name)}
            {row("เบอร์โทรติดต่อ", formatPhone(booking.phone))}
            {row("คืนที่จอง", shortThaiDate(booking.serviceDate))}
            {row("จำนวน / โซน", `${PARTY_LABEL[booking.party]} · ${booking.zoneName}`)}
            {row("ช่องทาง", `${CHANNEL_LABEL[booking.channel]} · ${booking.reference}`)}
            {row("สถานะ", STATUS_LABEL[booking.status])}
          </div>
        )}
        {booking && checked && (
          <div className={styles.dRows}>
            {row("ลูกค้า", booking.name)}
            {row("โซน", booking.zoneName)}
            {row("สถานะ", STATUS_LABEL[booking.status])}
          </div>
        )}
        {error && <p role="alert" className={styles.dError}>{error}</p>}
        {booking && !checked && !booking.canCheckIn && booking.status === "confirmed" && (
          <p className={styles.dError} style={{ color: "#77716c" }}>เช็กอินได้เฉพาะในคืนที่จองเท่านั้น</p>
        )}

        <div className={styles.dActions}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} disabled={busy}
            onClick={checked ? () => setView("details") : onClose}>กลับ</button>
          {checked
            ? <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onClose}>กลับไปยังรายการ</button>
            : booking && booking.status === "confirmed" &&
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy || !booking.canCheckIn} onClick={checkIn}>
                {busy ? "กำลังบันทึก…" : "เช็กอิน"}
              </button>}
        </div>
      </div>
    </div>
  );
}
