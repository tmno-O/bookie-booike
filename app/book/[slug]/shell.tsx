import Link from "next/link";
import type { ReactNode } from "react";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import styles from "./shell.module.css";
import { AnnouncementBanner } from "./announcement-banner";

const plex = IBM_Plex_Sans_Thai({ subsets: ["thai", "latin"], weight: ["400", "600"] });

// Shared mobile frame (header + sticky CTA) for the booking flow screens.
export function Shell({ slug, back, children, cta }: {
  slug: string; back: string; children: ReactNode; cta: { label: string; href?: string; onClick?: () => void; disabled?: boolean };
}) {
  return (
    <div className={`${styles.root} ${plex.className}`}>
      <div className={styles.screen}>
        <header className={styles.header}>
          <Link href={back} className={styles.back} aria-label="ย้อนกลับ">‹</Link>
          <span className={styles.brand}>Bookie lyon.</span>
          <Link href={`/book/${slug}/bookings`} className={styles.mine}>การจองของฉัน</Link>
        </header>
        <main className={styles.body}><AnnouncementBanner />{children}</main>
        <div className={styles.footer}>
          {cta.href && !cta.disabled
            ? <Link href={cta.href} className={styles.cta}>{cta.label}</Link>
            : <button type="button" className={styles.cta} disabled={cta.disabled} onClick={cta.onClick}>{cta.label}</button>}
        </div>
      </div>
    </div>
  );
}

export { styles as shellStyles };
