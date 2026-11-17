"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, thaiDate, type Booking } from "./flow";
import styles from "./active-booking.module.css";

type Active = Pick<Booking, "id" | "serviceDate" | "canCancel">;

export function useActiveBooking(slug: string) {
  const [active, setActive] = useState<Active | null>();
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((current) => current + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    api<{ bookings: Active[] }>("/bookings?active=1", { signal: controller.signal })
      .then(({ bookings }) => { if (!controller.signal.aborted) setActive(bookings[0] ?? null); })
      .catch(() => { if (!controller.signal.aborted) setActive(null); });
    return () => controller.abort();
  }, [slug, version]);
  useEffect(() => {
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, [refresh]);
  return { active, refresh };
}

export function ActiveBookingNotice({ slug, booking }: { slug: string; booking: Active }) {
  const detail = `/book/${slug}/confirmed?b=${encodeURIComponent(booking.id)}`;
  return (
    <aside aria-label="การจองเดิม" className={styles.notice}>
      <div className={styles.summary}>
        <span className={styles.icon} aria-hidden="true"><span className={styles.calendar} /></span>
        <div>
          <p className={styles.label}>คุณมีการจองอยู่แล้ว</p>
          <time className={styles.date} dateTime={booking.serviceDate}>{thaiDate(booking.serviceDate)}</time>
        </div>
      </div>
      <p className={styles.message}>
        {booking.canCancel ? "จองใหม่ได้หลังวันจองเดิม หรือเมื่อยกเลิกการจองนี้" : "จองใหม่ได้หลังวันจองเดิม"}
      </p>
      <div className={styles.actions}>
        <Link className={styles.primary} href={detail}>ดูการจองเดิม</Link>
        {booking.canCancel && <Link className={styles.secondary} href={`${detail}#cancel-booking`}>ไปที่การยกเลิก</Link>}
      </div>
    </aside>
  );
}
