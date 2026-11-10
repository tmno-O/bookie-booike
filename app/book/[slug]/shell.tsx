import Link from "next/link";
import type { ReactNode } from "react";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import styles from "./shell.module.css";

const plex = IBM_Plex_Sans_Thai({ subsets: ["thai", "latin"], weight: ["400", "600"] });

// Shared mobile frame (header + sticky CTA) for the booking flow screens.
export function Shell({ slug, back, children, cta }: {
  slug: string; back: string; children: ReactNode; cta: { href: string; label: string };
}) {
  return (
    <div className={`${styles.root} ${plex.className}`}>
      <div className={styles.screen}>
        <header className={styles.header}>
          <Link href={back} className={styles.back} aria-label="ย้อนกลับ">‹</Link>
          <span className={styles.brand}>Bookie lyon.</span>
          {/* TODO: point to the "my bookings" screen once built (06) */}
          <Link href={`/book/${slug}`} className={styles.mine}>การจองของฉัน</Link>
        </header>
        <main className={styles.body}>{children}</main>
        <div className={styles.footer}>
          <Link href={cta.href} className={styles.cta}>{cta.label}</Link>
        </div>
      </div>
    </div>
  );
}

export { styles as shellStyles };
