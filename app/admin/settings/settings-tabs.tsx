import Link from "next/link";
import styles from "../admin.module.css";
import tabStyles from "./settings-pages.module.css";

const TABS = [
  { id: "hours", href: "/admin/settings/hours", label: "เวลาเปิด–ปิดร้าน" },
  { id: "cancellation", href: "/admin/settings/cancellation", label: "เงื่อนไขการยกเลิก" },
  { id: "notifications", href: "/admin/settings/notifications", label: "แจ้งเตือน LINE" },
] as const;

// Shared header for the shop-settings sub pages (Figma "Admin · 06a / 06b / 06c").
export function SettingsHeader({ tab, canSave, busy, onSave }: {
  tab: (typeof TABS)[number]["id"]; canSave: boolean; busy: boolean; onSave: () => void;
}) {
  return (
    <>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.h1}>ตั้งค่าร้าน</h1>
          <p className={styles.sub}>กำหนดเวลาให้บริการและเงื่อนไขสำหรับลูกค้า</p>
        </div>
        {canSave && (
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={onSave}>
            {busy ? "กำลังบันทึก…" : "บันทึกการเปลี่ยนแปลง"}
          </button>
        )}
      </div>
      <nav className={tabStyles.tabs} aria-label="หมวดการตั้งค่าร้าน">
        {TABS.map((t) => (
          <Link key={t.id} href={t.href} aria-current={t.id === tab ? "page" : undefined}
            className={`${tabStyles.tab} ${t.id === tab ? tabStyles.tabOn : ""}`}>{t.label}</Link>
        ))}
      </nav>
    </>
  );
}
