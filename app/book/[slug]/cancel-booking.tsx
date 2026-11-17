"use client";

import { useEffect, useRef, useState } from "react";
import { api, asFailure, type Booking } from "./flow";
import styles from "./bookings/bookings.module.css";

export const deadlineText = (iso: string) => new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok",
}).format(new Date(iso));

export function CancellationNote({ booking }: { booking: Booking }) {
  if (booking.status === "cancelled" || booking.status === "checked_in") return null;
  return <p>{booking.cancellableUntil ? `ยกเลิกได้ถึง ${deadlineText(booking.cancellableUntil)} น.` : "ร้านปิดการยกเลิกด้วยตนเอง กรุณาติดต่อร้าน"}</p>;
}

export function CancelBooking({ booking, onChanged }: { booking: Booking; onChanged: (b: Booking) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  if (booking.status === "cancelled" || booking.status === "checked_in") return null;
  const allowed = booking.canCancel && !!booking.cancellableUntil && now < Date.parse(booking.cancellableUntil);
  async function cancel() {
    setBusy(true); setError("");
    try {
      const { booking: updated } = await api<{ booking: Booking }>(`/bookings/${booking.id}/cancel`, { method: "POST" });
      dialog.current?.close(); onChanged(updated);
    } catch (e) {
      setError(asFailure(e).message);
      const latest = await api<{ booking: Booking }>(`/bookings/${booking.id}`).catch(() => undefined);
      if (latest) onChanged(latest.booking);
    } finally { setBusy(false); }
  }
  return <>
    <CancellationNote booking={booking} />
    <button type="button" className={styles.cancelBtn} disabled={!allowed} onClick={() => dialog.current?.showModal()}>ยกเลิกการจอง</button>
    {!allowed && booking.cancellableUntil && <p>เลยกำหนดยกเลิก ติดต่อร้าน</p>}
    <dialog ref={dialog} className={styles.cancelDialog} onCancel={(e) => { if (busy) e.preventDefault(); }}>
      <h2>ยืนยันยกเลิกการจอง</h2>
      <p>{booking.reference} · ยกเลิกแล้วโต๊ะจะเปิดให้ผู้อื่นจอง</p>
      {error && <p role="alert">{error}</p>}
      <div className={styles.cancelActions}>
        <button type="button" className={styles.keepBtn} disabled={busy} onClick={() => dialog.current?.close()}>เก็บการจองไว้</button>
        <button type="button" className={styles.confirmBtn} disabled={busy} onClick={cancel}>{busy ? "กำลังยกเลิก…" : "ยืนยันยกเลิก"}</button>
      </div>
    </dialog>
  </>;
}
