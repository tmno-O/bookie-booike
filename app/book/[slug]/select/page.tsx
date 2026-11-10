import Link from "next/link";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import SelectForm from "./select-form";
import styles from "./select.module.css";

const plex = IBM_Plex_Sans_Thai({ subsets: ["thai", "latin"], weight: ["400", "600"] });

export default async function SelectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const today = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date());
  return (
    <div className={`${styles.root} ${plex.className}`}>
      <div className={styles.screen}>
        <header className={styles.header}>
          <Link href={`/book/${slug}/details`} className={styles.back} aria-label="ย้อนกลับ">‹</Link>
          <span className={styles.brand}>Bookie lyon.</span>
          {/* TODO: point to the "my bookings" screen once built (06) */}
          <Link href={`/book/${slug}`} className={styles.mine}>การจองของฉัน</Link>
        </header>
        <SelectForm slug={slug} today={today} />
      </div>
    </div>
  );
}
