import { Shell, shellStyles as s } from "../shell";
import styles from "./confirmed.module.css";

// Booking confirmed (Figma "05 · ยืนยันการจอง", node 169:406)
export default async function ConfirmedPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // TODO: replace sample data with GET /api/me/booking-requests/{requestId} + /api/me/bookings/{bookingId}
  return (
    <Shell slug={slug} back={`/book/${slug}/select`} cta={{ href: `/book/${slug}`, label: "ดูการจองของฉัน" }}>
      <p className={s.eyebrow}>การจองสำเร็จ</p>
      <h1 className={s.title}>ยืนยันการจองแล้ว</h1>
      <p className={s.subtitle}>นำข้อมูลการจองนี้แสดงกับพนักงานเมื่อมาถึง</p>
      <div className={styles.ref}>
        <p className={styles.refLabel}>เลขอ้างอิงตัวอย่าง</p>
        <p className={styles.refValue}>BL-2026-0012</p>
      </div>
      <dl className={styles.details}>
        <div className={styles.wide}><dt className={styles.dl}>คืนที่จอง</dt><dd className={`${styles.dd} ${styles.lg}`}>11 พฤศจิกายน 2026</dd></div>
        <div><dt className={styles.dl}>จำนวนผู้เข้าร่วม</dt><dd className={styles.dd}>1–4 คน</dd></div>
        <div><dt className={styles.dl}>โซน</dt><dd className={styles.dd}>ยังไม่ได้เลือกโซน</dd></div>
      </dl>
      <p className={styles.contact}><b>ชื่อลูกค้า</b>เจ๊ม่อน<br /><span style={{ fontWeight: 400 }}>เบอร์โทร&nbsp; 0919119911</span></p>
      <p className={styles.line}>การแจ้งเตือน LINE</p>
      <p className={styles.lineNote}>ยังไม่มีข้อมูลการส่งข้อความ</p>
    </Shell>
  );
}
