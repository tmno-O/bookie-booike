"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { api, asFailure } from "../flow";
import styles from "./login.module.css";

type Account = { userId: string; displayName: string };

// Mock "Log in with LINE": pick a fake LINE account, send its mock ID token (same format as
// LINE_VERIFY_MODE=mock) to the mock session endpoint, then continue to the booking flow.
export default function LoginScreen({ slug }: { slug: string }) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api<{ accounts: Account[] }>("/line/accounts").then((r) => active && setAccounts(r.accounts))
      .catch((e) => active && setError(asFailure(e).message));
    return () => { active = false; };
  }, []);

  async function login(userId: string, displayName: string) {
    setBusy(true); setError("");
    try {
      await api("/line/login", { method: "POST", body: { idToken: `mock:${userId}:${displayName}` } });
      router.push(`/book/${slug}/details`);
    } catch (e) {
      setError(asFailure(e).message); setBusy(false);
    }
  }
  const loginCustom = (event: FormEvent) => {
    event.preventDefault();
    const name = custom.trim();
    if (name) void login(`Ucustom${Date.now().toString(36)}`, name);
  };

  return (
    <div className={styles.root}>
      <main className={styles.screen}>
        <p className={styles.brand}>Bookie lyon.</p>
        <h1 className={styles.title}>เข้าสู่ระบบด้วย LINE</h1>
        <p className={styles.subtitle}>เพื่อรับคิวและดูการจองของคุณ</p>
        <p className={styles.banner}>หน้าจำลองสำหรับทดสอบเท่านั้น — ไม่ได้เชื่อมต่อ LINE จริง</p>

        <p className={styles.label}>เลือกบัญชี LINE ทดสอบ</p>
        <ul className={styles.list}>
          {accounts.map((a) => (
            <li key={a.userId}>
              <button type="button" className={styles.account} disabled={busy} onClick={() => login(a.userId, a.displayName)}>
                <span className={styles.avatar} aria-hidden>L</span>
                {a.displayName}<span className={styles.id}>{a.userId}</span>
              </button>
            </li>
          ))}
        </ul>

        <form className={styles.custom} onSubmit={loginCustom}>
          <input className={styles.input} value={custom} maxLength={60} placeholder="หรือพิมพ์ชื่อบัญชีใหม่"
            aria-label="ชื่อบัญชี LINE ใหม่" onChange={(e) => setCustom(e.target.value)} />
          <button type="submit" className={styles.go} disabled={busy || !custom.trim()}>เข้าสู่ระบบ</button>
        </form>
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </main>
    </div>
  );
}
