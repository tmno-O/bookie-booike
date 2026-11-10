"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { adminApi, asFailure, type Staff } from "../admin-api";
import styles from "./login.module.css";

// Mock staff sign-in (stands in for Supabase email/password until the real backend is connected).
export default function AdminLogin() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Staff[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    adminApi<{ accounts: Staff[] }>("/admin/accounts").then((r) => active && setAccounts(r.accounts))
      .catch((e) => active && setError(asFailure(e).message));
    return () => { active = false; };
  }, []);

  async function login(email: string) {
    setBusy(true); setError("");
    try {
      await adminApi("/admin/login", { method: "POST", body: { email } });
      router.push("/admin");
    } catch (e) {
      setError(asFailure(e).message); setBusy(false);
    }
  }

  return (
    <div className={styles.root}>
      <main className={styles.card}>
        <p className={styles.brand}>Bookie lyon.</p>
        <p className={styles.tag}>สำหรับร้านค้า</p>
        <h1 className={styles.title}>เข้าสู่ระบบร้านค้า</h1>
        <p className={styles.banner}>หน้าจำลองสำหรับทดสอบเท่านั้น — เลือกบัญชีพนักงานทดสอบ</p>
        <ul className={styles.list}>
          {accounts.map((a) => (
            <li key={a.email}>
              <button type="button" className={styles.account} disabled={busy} onClick={() => login(a.email)}>
                <span>{a.displayName}<small>{a.role === "owner" ? "สิทธิ์เจ้าของร้าน" : "สิทธิ์พนักงาน"}</small></span>
                <span className={styles.email}>{a.email}</span>
              </button>
            </li>
          ))}
        </ul>
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </main>
    </div>
  );
}
