"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { adminApi, asFailure, realApiMode, type Staff } from "../admin-api";
import styles from "./login.module.css";

export default function AdminLogin() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Staff[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [venueSlug, setVenueSlug] = useState("");
  const [requiresVenue, setRequiresVenue] = useState(false);

  useEffect(() => {
    if (realApiMode) return;
    let active = true;
    adminApi<{ accounts: Staff[] }>("/admin/accounts").then((r) => active && setAccounts(r.accounts))
      .catch((e) => active && setError(asFailure(e).message));
    return () => { active = false; };
  }, []);

  async function login(credentials: { email: string; password?: string; venueSlug?: string }) {
    setBusy(true); setError("");
    try {
      await adminApi("/admin/login", { method: "POST", body: credentials });
      router.push("/admin");
    } catch (e) {
      const failure = asFailure(e);
      if (failure.code === "VENUE_REQUIRED") setRequiresVenue(true);
      setError(failure.message);
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void login({ email: email.trim(), password, venueSlug: venueSlug.trim() || undefined });
  }

  return (
    <div className={styles.root}>
      <main className={styles.card}>
        <p className={styles.brand}>Bookie lyon.</p>
        <p className={styles.tag}>สำหรับร้านค้า</p>
        <h1 className={styles.title}>เข้าสู่ระบบร้านค้า</h1>
        {realApiMode ? (
          <form className={styles.form} onSubmit={submit}>
            <label>อีเมล<input required type="email" autoComplete="username" value={email}
              onChange={(event) => setEmail(event.target.value)} /></label>
            <label>รหัสผ่าน<input required type="password" autoComplete="current-password" value={password}
              onChange={(event) => setPassword(event.target.value)} /></label>
            {requiresVenue && <label>รหัสร้าน<input required autoComplete="off" value={venueSlug}
              pattern="[a-z0-9]+(-[a-z0-9]+)*" onChange={(event) => setVenueSlug(event.target.value)} /></label>}
            <button type="submit" className={styles.submit} disabled={busy}>{busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}</button>
          </form>
        ) : <>
        <p className={styles.banner}>หน้าจำลองสำหรับทดสอบเท่านั้น — เลือกบัญชีพนักงานทดสอบ</p>
        <ul className={styles.list}>
          {accounts.map((a) => (
            <li key={a.email}>
              <button type="button" className={styles.account} disabled={busy} onClick={() => login({ email: a.email })}>
                <span>{a.displayName}<small>{a.role === "owner" ? "สิทธิ์เจ้าของร้าน" : "สิทธิ์พนักงาน"}</small></span>
                <span className={styles.email}>{a.email}</span>
              </button>
            </li>
          ))}
        </ul>
        </>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </main>
    </div>
  );
}
