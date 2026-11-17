"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const moreRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    api<{ bookings: Booking[]; nextOffset?: number | null }>("/bookings").then((r) => {
      if (active) { setBookings(r.bookings); setNextOffset(r.nextOffset ?? null); }
    })
      .catch((e) => active && setError(asFailure(e).message));
    return () => { active = false; moreRequest.current?.abort(); };
  }, [revision]);

  async function loadMore() {
    if (nextOffset === null) return;
    const request = new AbortController();
    moreRequest.current = request;
    setLoadingMore(true);
    setError("");
    try {
      const result = await api<{ bookings: Booking[]; nextOffset: number | null }>(`/bookings?offset=${nextOffset}`, { signal: request.signal });
      if (request.signal.aborted) return;
      setBookings((current) => {
        const seen = new Set(current?.map(({ id }) => id));
        return [...(current ?? []), ...result.bookings.filter(({ id }) => !seen.has(id))];
      });
      setNextOffset(result.nextOffset);
    } catch (e) {
      if (!request.signal.aborted) setError(asFailure(e).message);
    } finally {
      if (!request.signal.aborted) setLoadingMore(false);
    }
  }

  function updateBooking(updated: Booking) {
    if (updated.status !== "cancelled") {
      setBookings((rows) => rows?.map((row) => row.id === updated.id ? updated : row));
      return;
    }
    moreRequest.current?.abort();
    setLoadingMore(false);
    setBookings((rows) => rows?.filter((row) => row.id !== updated.id));
    setNextOffset(null);
    setNotice(`${bookingStatusLabel.cancelled} · ${updated.reference}`);
    // Removing a row shifts the server's offsets. Reload page one before fetching another page.
    setRevision((previous) => previous + 1);
  }

  return (
    <Shell slug={slug} back={`/book/${slug}/details`} cta={{ href: `/book/${slug}/details`, label: "เริ่มการจองใหม่" }}>
      <h1 className={s.title} style={{ marginTop: 0 }}>การจองของฉัน</h1>
      <p className={s.subtitle}>ประวัติและสถานะการจอง</p>
      {error && <p role="alert" className={s.error}>{error}</p>}
      {notice && <p role="status" className={s.note}>{notice}</p>}
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
          <CancelBooking booking={b} onChanged={updateBooking} />
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
