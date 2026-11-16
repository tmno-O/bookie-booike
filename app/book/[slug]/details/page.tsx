import Link from "next/link";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import DetailsForm from "./details-form";
import styles from "./details.module.css";

const plex = IBM_Plex_Sans_Thai({ subsets: ["thai", "latin"], weight: ["400", "600"] });

// Step 1 of 4 — booker details (Figma "01 · ข้อมูลผู้จอง · New flow", node 169:382)
export const metadata = { title: "ข้อมูลผู้จอง" };

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
        <DetailsForm slug={slug} />
      </div>
    </div>
  );
}
