import Link from "next/link";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import styles from "./details.module.css";

const plex = IBM_Plex_Sans_Thai({ subsets: ["thai", "latin"], weight: ["400", "600"] });

// Step 1 of 4 — booker details (Figma "01 · ข้อมูลผู้จอง · New flow", node 169:382)
export default async function DetailsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <div className={`${styles.root} ${plex.className}`}>
    <div className={styles.screen}>
      <header className={styles.header}>
        <Link href="/" className={styles.back} aria-label="ย้อนกลับ">‹</Link>
        <span className={styles.brand}>Bookie lyon.</span>
        <Link href={`/book/${slug}/bookings`} className={styles.mine}>การจองของฉัน</Link>
      </header>
      <form className={styles.form} action={`/book/${slug}`}>
        <div className={styles.body}>
          <p className={styles.step}>ขั้นตอน 1 จาก 4</p>
          <h1 className={styles.title}>ข้อมูลผู้จอง</h1>
          <p className={styles.subtitle}>ใช้สำหรับติดต่อและยืนยันการจอง</p>
          <div className={styles.fields}>
            <div>
              <label className={styles.label} htmlFor="name">ชื่อลูกค้า</label>
              <input id="name" name="name" className={styles.input} defaultValue="เจ๊ม่อน" autoComplete="name" required />
            </div>
            <div>
              <label className={styles.label} htmlFor="phone">เบอร์โทรศัพท์</label>
              <input id="phone" name="phone" className={styles.input} defaultValue="0919119911" type="tel" inputMode="tel" autoComplete="tel" required />
            </div>
          </div>
          <p className={styles.hint}>ข้อมูลตัวอย่างสำหรับทดลองต้นแบบ</p>
        </div>
        <div className={styles.footer}>
          <button type="submit" className={styles.cta}>ดำเนินการต่อ</button>
        </div>
      </form>
    </div>
    </div>
  );
}
