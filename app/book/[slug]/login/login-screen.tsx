"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, asFailure, loadCustomer, realApiMode } from "../flow";
import styles from "./login.module.css";

type Account = { userId: string; displayName: string };

type Liff = {
  init(options: { liffId: string }): Promise<void>;
  isLoggedIn(): boolean;
  getIDToken(): string | null;
  login(options: { redirectUri: string }): void;
};

export default function LoginScreen({ slug, mockLine }: { slug: string; mockLine: boolean }) {
  const demo = !realApiMode || mockLine;
  return demo ? <DemoLogin slug={slug} /> : <LiffLogin slug={slug} />;
}

function LiffLogin({ slug }: { slug: string }) {
  const router = useRouter();
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [sdk, setSdk] = useState<Liff>();
  const [error, setError] = useState("");
  const initialized = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const liff = (window as Window & { liff?: Liff }).liff;
    if (!sdkLoaded || !liff) return;
    let active = true;
    initialized.current ??= api<{ liffId: string | null }>(`/venues/by-slug/${encodeURIComponent(slug)}`).then(({ liffId }) => {
      if (!liffId) throw new Error("ร้านยังไม่ได้ตั้งค่า LINE");
      return liff.init({ liffId });
    });
    void initialized.current.then(async () => {
      if (!active) return;
      if (!liff.isLoggedIn()) { setSdk(liff); return; }
      const idToken = liff.getIDToken();
      if (!idToken) throw new Error("LINE ไม่ได้ส่ง ID token");
      await api("/line/login", { method: "POST", body: { idToken } });
      if (active) router.replace(`/book/${slug}/${new URLSearchParams(window.location.search).get("next") === "waiting" && loadCustomer() ? "waiting" : "details"}`);
    }).catch((e) => active && setError(e instanceof Error ? e.message : asFailure(e).message));
    return () => { active = false; };
  }, [router, sdkLoaded, slug]);

  return (
    <div className={styles.root}>
      <Script src="https://static.line-scdn.net/liff/edge/2/sdk.js" onReady={() => setSdkLoaded(true)}
        onError={() => setError("โหลด LINE ไม่สำเร็จ")} />
      <main className={styles.screen}>
        <p className={styles.brand}>Bookie lyon.</p>
        <h1 className={styles.title}>เข้าสู่ระบบด้วย LINE</h1>
        <p className={styles.subtitle}>เพื่อรับคิวและดูการจองของคุณ</p>
        <button type="button" className={styles.go} disabled={!sdk}
          onClick={() => sdk?.login({ redirectUri: `${location.origin}${location.pathname}${location.search}` })}>เข้าสู่ระบบ</button>
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </main>
    </div>
  );
}

function DemoLogin({ slug }: { slug: string }) {
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
