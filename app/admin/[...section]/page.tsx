"use client";

import { AdminShell, NAV } from "../admin-shell";
import styles from "../admin.module.css";
import { usePathname } from "next/navigation";
import Link from "next/link";

// Placeholder for admin pages that are designed in Figma but not built yet.
export default function ComingSoon() {
  const pathname = usePathname();
  const active = NAV.find((n) => n.href !== "/admin" && pathname.startsWith(n.href))?.href ?? "";
  return (
    <AdminShell active={active}>
      <div className={styles.placeholder}>
        <h1 className={styles.h1}>กำลังพัฒนา</h1>
        <p className={styles.sub}>หน้านี้ยังไม่พร้อมใช้งานในเวอร์ชันทดสอบ</p>
        <p style={{ marginTop: 24 }}><Link href="/admin" className={styles.primary}>กลับไปภาพรวม</Link></p>
      </div>
    </AdminShell>
  );
}
