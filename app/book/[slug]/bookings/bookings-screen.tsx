"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell, shellStyles as s } from "../shell";
import { api, asFailure, partyLabel, thaiDate, type Booking } from "../flow";
import styles from "./bookings.module.css";

export default function BookingsScreen({ slug }: { slug: string }) {
  const [bookings, setBookings] = useState<Booking[]>();
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api<{ bookings: Booking[] }>("/bookings").then((r) => active && setBookings(r.bookings))
      .catch((e) => active && setError(asFailure(e).message));
    return () => { active = false; };
  }, []);

  return (
    <Shell slug={slug} back={`/book/${slug}/details`} cta={{ href: `/book/${slug}/details`, label: "เริ่มการจองใหม่" }}>
      <p className={s.eyebrow}>การจอง</p>
      <h1 className={s.title}>การจองของฉัน</h1>
      <p className={s.subtitle}>การจองที่กำลังจะมาถึง</p>
      {error && <p role="alert" className={s.error}>{error}</p>}
      {bookings?.length === 0 && <p className={s.note} style={{ padding: "57px 0 0" }}>ยังไม่มีการจอง</p>}
      {bookings?.map((b, i) => (
        <section key={b.id} aria-label={b.reference}>
          <dl className={styles.card} style={i ? { marginTop: 24 } : undefined}>
            <div className={styles.wide}><dt className={styles.dl}>คืนที่จอง</dt><dd className={`${styles.dd} ${styles.lg}`}>{thaiDate(b.serviceDate)}</dd></div>
            <div><dt className={styles.dl}>จำนวนผู้เข้าร่วม</dt><dd className={styles.dd}>{partyLabel(b.party)}</dd></div>
            <div><dt className={styles.dl}>โซน</dt><dd className={styles.dd}>{b.zoneName}</dd></div>
          </dl>
          <Link href={`/book/${slug}/confirmed?b=${b.id}`} className={styles.secondary}>ดูรายละเอียดการจอง</Link>
        </section>
      ))}
    </Shell>
  );
}
