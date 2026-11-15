"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Shell, shellStyles as s } from "../shell";
import { api, asFailure, bookingStatusLabel, partyLabel, thaiDate, type Booking } from "../flow";
import styles from "./confirmed.module.css";
import { CancelBooking } from "../cancel-booking";

export default function ConfirmedScreen({ slug }: { slug: string }) {
  const id = useSearchParams().get("b");
  const [booking, setBooking] = useState<Booking>();
  const [error, setError] = useState(id ? "" : "ไม่พบข้อมูลการจอง");

  useEffect(() => {
    if (!id) return;
    let active = true;
    api<{ booking: Booking }>(`/bookings/${id}`).then((r) => active && setBooking(r.booking))
      .catch((e) => active && setError(asFailure(e).status === 404 ? "ไม่พบข้อมูลการจอง" : asFailure(e).message));
    return () => { active = false; };
  }, [id]);

  const status = booking?.status ?? "confirmed";
  const pending = status === "pending_allocation" || status === "pending";

  return (
    <Shell slug={slug} back={`/book/${slug}/bookings`} cta={{ href: `/book/${slug}/bookings`, label: "ดูการจองของฉัน" }}>
      <p className={s.eyebrow}>สถานะการจอง</p>
      <h1 className={s.title}>{booking ? bookingStatusLabel[status] : "รายละเอียดการจอง"}</h1>
      {booking && status !== "cancelled" && <p className={s.subtitle}>
        {pending ? "ร้านได้รับคำขอแล้ว กรุณาติดตามสถานะการจัดสรรโซน" : "นำข้อมูลการจองนี้แสดงกับพนักงานเมื่อมาถึง"}
      </p>}
      {error && <p role="alert" className={s.error}>{error}</p>}
      {booking && <>
        <div className={styles.ref}>
          <p className={styles.refLabel}>เลขอ้างอิง</p>
          <p className={styles.refValue}>{booking.reference}</p>
        </div>
        <dl className={styles.details}>
          <div className={styles.wide}><dt className={styles.dl}>คืนที่จอง</dt><dd className={`${styles.dd} ${styles.lg}`}>{thaiDate(booking.serviceDate)}</dd></div>
          <div><dt className={styles.dl}>จำนวนผู้เข้าร่วม</dt><dd className={styles.dd}>{partyLabel(booking.party)}</dd></div>
          <div><dt className={styles.dl}>{pending ? "โซนที่ขอ" : "โซน"}</dt><dd className={styles.dd}>{booking.zoneName}</dd></div>
        </dl>
        <p className={styles.contact}><b>ชื่อลูกค้า</b>{booking.name}<br /><span style={{ fontWeight: 400 }}>เบอร์โทร&nbsp; {booking.phone}</span></p>
        <CancelBooking booking={booking} onChanged={setBooking} />
        <p className={styles.line}>การแจ้งเตือน LINE</p>
        <p className={styles.lineNote}>ยังไม่มีข้อมูลการส่งข้อความ</p>
      </>}
    </Shell>
  );
}
