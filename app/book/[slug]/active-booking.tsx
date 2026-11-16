"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, thaiDate, type Booking } from "./flow";
import styles from "./shell.module.css";

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
    <aside aria-label="การจองเดิม" className={`${styles.card} ${styles.cardAccent}`} style={{ marginBlock: 16 }}>
      <p>คุณมีการจองวันที่ {thaiDate(booking.serviceDate)} แล้ว จองใหม่ได้หลังวันนั้น หรือเมื่อยกเลิกการจองเดิม</p>
      <p><Link href={detail}>ดูการจองเดิม</Link>{booking.canCancel && <> · <Link href={`${detail}#cancel-booking`}>ไปที่การยกเลิก</Link></>}</p>
    </aside>
  );
}
