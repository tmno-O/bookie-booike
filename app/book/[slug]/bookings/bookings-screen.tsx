"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell, shellStyles as s } from "../shell";
import { api, asFailure, bookingStatusLabel, partyLabel, thaiDate, type Booking } from "../flow";
import styles from "./bookings.module.css";
import { CancelBooking } from "../cancel-booking";
import { BookingReceipt } from "../booking-receipt";

export default function BookingsScreen({ slug }: { slug: string }) {
  const [bookings, setBookings] = useState<Booking[]>();
  const [error, setError] = useState("");
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let active = true;
    api<{ bookings: Booking[]; nextOffset?: number | null }>("/bookings").then((r) => {
      if (active) { setBookings(r.bookings); setNextOffset(r.nextOffset ?? null); }
    })
      .catch((e) => active && setError(asFailure(e).message));
    return () => { active = false; };
  }, []);

  async function loadMore() {
    if (nextOffset === null) return;
    setLoadingMore(true);
    setError("");
    try {
      const result = await api<{ bookings: Booking[]; nextOffset: number | null }>(`/bookings?offset=${nextOffset}`);
      setBookings((current) => {
        const seen = new Set(current?.map(({ id }) => id));
        return [...(current ?? []), ...result.bookings.filter(({ id }) => !seen.has(id))];
      });
      setNextOffset(result.nextOffset);
    } catch (e) {
      setError(asFailure(e).message);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <Shell slug={slug} back={`/book/${slug}/details`} cta={{ href: `/book/${slug}/details`, label: "เริ่มการจองใหม่" }}>
      <h1 className={s.title}>การจองของฉัน</h1>
      <p className={s.subtitle}>ประวัติและสถานะการจอง</p>
      {error && <p role="alert" className={s.error}>{error}</p>}
      {bookings?.length === 0 && <p className={s.note} style={{ padding: "57px 0 0" }}>ยังไม่มีการจอง</p>}
      {bookings?.map((b, i) => (
        <section key={b.id} aria-label={b.reference}>
          <dl className={styles.card} style={i ? { marginTop: 24 } : undefined}>
            <div className={styles.wide}><dt className={styles.dl}>คืนที่จอง</dt><dd className={`${styles.dd} ${styles.lg}`}>{thaiDate(b.serviceDate)}</dd></div>
            <div><dt className={styles.dl}>จำนวนผู้เข้าร่วม</dt><dd className={styles.dd}>{partyLabel(b.party)}</dd></div>
            <div><dt className={styles.dl}>โซน</dt><dd className={styles.dd}>{b.zoneName}</dd></div>
            <div><dt className={styles.dl}>เลขอ้างอิง</dt><dd className={styles.dd}>{b.reference}</dd></div>
            {b.status && <div><dt className={styles.dl}>สถานะ</dt><dd className={styles.dd}>{bookingStatusLabel[b.status]}</dd></div>}
          </dl>
          <Link href={`/book/${slug}/confirmed?b=${b.id}`} className={styles.secondary}>ดูรายละเอียดการจอง</Link>
          <CancelBooking booking={b} onChanged={(updated) => setBookings((rows) => rows?.map((row) => row.id === updated.id ? updated : row))} />
          <BookingReceipt booking={b} />
        </section>
      ))}
      {nextOffset !== null && (
        <button type="button" className={styles.more} disabled={loadingMore} onClick={loadMore}>
          {loadingMore ? "กำลังโหลด…" : "ดูการจองเพิ่มเติม"}
        </button>
      )}
    </Shell>
  );
}
