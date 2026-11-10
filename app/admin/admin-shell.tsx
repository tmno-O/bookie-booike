"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import { adminApi, type Staff } from "./admin-api";
import styles from "./admin.module.css";

const plex = IBM_Plex_Sans_Thai({ subsets: ["thai", "latin"], weight: ["400", "500", "600", "700"] });

export const NAV = [
  { href: "/admin", label: "ภาพรวม" },
  { href: "/admin/bookings", label: "รายการจอง" },
  { href: "/admin/queue", label: "คิวการจอง" },
  { href: "/admin/zones", label: "โซนและความจุ" },
  { href: "/admin/hours", label: "เวลาเปิดจอง" },
  { href: "/admin/settings", label: "ตั้งค่าร้าน" },
];

// Staff layout from Figma "Admin · 01 · ภาพรวมร้านค้า": sidebar, top bar, content area.
export function AdminShell({ active, staff, children }: { active: string; staff?: Staff; children: ReactNode }) {
  const router = useRouter();
  async function logout() {
    await adminApi("/admin/logout", { method: "POST" }).catch(() => undefined);
    router.push("/admin/login");
  }
  return (
    <div className={`${styles.root} ${plex.className}`}>
      <aside className={styles.sidebar}>
        <p className={styles.brand}>Bookie lyon.</p>
        <p className={styles.tagline}>สำหรับร้านค้า</p>
        <hr className={styles.rule} />
        <p className={styles.venueLabel}>ร้านของฉัน</p>
        <p className={styles.venue}>ร้านตัวอย่าง</p>
        <nav className={styles.nav} aria-label="เมนูร้านค้า">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} aria-current={item.href === active ? "page" : undefined}
              className={`${styles.navLink} ${item.href === active ? styles.navActive : ""}`}>{item.label}</Link>
          ))}
        </nav>
        {staff && (
          <div className={styles.me}>
            <hr className={styles.rule} style={{ margin: "0 8px 20px" }} />
            <p className={styles.meName}>{staff.displayName}</p>
            <p className={styles.meRole}>{staff.role === "owner" ? "สิทธิ์เจ้าของร้าน" : "สิทธิ์พนักงาน"}</p>
            <button type="button" className={styles.logout} onClick={logout}>ออกจากระบบ</button>
          </div>
        )}
      </aside>
      <div className={styles.main}>
        <header className={styles.topbar}>
          <span className={styles.topTitle}>ร้านตัวอย่าง</span>
          <span className={styles.topNote}>จัดการร้าน</span>
        </header>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
