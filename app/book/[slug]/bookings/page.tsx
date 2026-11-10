import Link from "next/link";
import { Shell, shellStyles as s } from "../shell";
import styles from "./bookings.module.css";

// My bookings (Figma "06 · การจองของฉัน", node 169:412)
export default async function BookingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // TODO: replace sample data with GET /api/me/bookings
  return (
    <Shell slug={slug} back={`/book/${slug}/confirmed`} cta={{ href: `/book/${slug}/details`, label: "เริ่มการจองใหม่" }}>
      <p className={s.eyebrow}>การจอง</p>
      <h1 className={s.title}>การจองของฉัน</h1>
      <p className={s.subtitle}>การจองที่กำลังจะมาถึง</p>
      <dl className={styles.card}>
        <div className={styles.wide}><dt className={styles.dl}>คืนที่จอง</dt><dd className={`${styles.dd} ${styles.lg}`}>11 พฤศจิกายน 2026</dd></div>
        <div><dt className={styles.dl}>จำนวนผู้เข้าร่วม</dt><dd className={styles.dd}>1–4 คน</dd></div>
        <div><dt className={styles.dl}>โซน</dt><dd className={styles.dd}>ยังไม่ได้เลือกโซน</dd></div>
      </dl>
      <Link href={`/book/${slug}/confirmed`} className={styles.secondary}>ดูรายละเอียดการจอง</Link>
    </Shell>
  );
}
