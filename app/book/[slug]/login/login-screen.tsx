"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiRequest } from "@/client/transport";
import { slug as venueSlug } from "@/contracts/common";
import { api, asFailure, loadCustomer, realApiMode } from "../flow";
import styles from "./login.module.css";

type Account = { userId: string; displayName: string };

type Liff = {
  init(options: { liffId: string }): Promise<void>;
  isLoggedIn(): boolean;
  getIDToken(): string | null;
  login(options: { redirectUri: string }): void;
  logout(): void;
};

// A stale or rejected LIFF ID token is cleared once and LINE login restarts; a second failure is shown instead.
const RELOGIN_KEY = "bookie:liff-relogin";
const RENEWABLE = new Set(["LINE_TOKEN_EXPIRED", "INVALID_LINE_TOKEN"]);
function storage() { try { return window.sessionStorage; } catch { return null; } }

export default function LoginScreen({ slug, mockLine }: { slug: string; mockLine: boolean }) {
  const [result, setResult] = useState<{ slug: string; liffId?: string | null; error?: string }>();

  useEffect(() => {
    if (!venueSlug.safeParse(slug).success) return;
    const controller = new AbortController();
    const encoded = encodeURIComponent(slug);
    const path = realApiMode ? `/api/venues/by-slug/${encoded}` : `/api/mock/venue?slug=${encoded}`;
    apiRequest<{ liffId?: string | null }>(path, { signal: controller.signal })
      .then(({ liffId }) => setResult({ slug, liffId }))
      .catch((e) => {
        if (controller.signal.aborted) return;
        const failure = asFailure(e);
        setResult({ slug, error: failure.status === 404 ? "ไม่พบร้าน" : failure.message });
      });
    return () => controller.abort();
  }, [slug]);

  const current = result?.slug === slug ? result : undefined;
  const status = venueSlug.safeParse(slug).success ? current?.error : "ไม่พบร้าน";
  if (status || !current) return (
    <div className={styles.root}>
      <main className={styles.screen}>
        <p className={styles.brand}>Bookie lyon.</p>
        <h1 className={styles.title} role={status ? "alert" : "status"}>{status ?? "กำลังโหลดข้อมูลร้าน…"}</h1>
      </main>
    </div>
  );
  return !realApiMode || mockLine ? <DemoLogin slug={slug} /> : <LiffLogin slug={slug} liffId={current.liffId} />;
}

function LiffLogin({ slug, liffId }: { slug: string; liffId?: string | null }) {
  const router = useRouter();
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [sdk, setSdk] = useState<Liff>();
  const [error, setError] = useState("");
  const initialized = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const liff = (window as Window & { liff?: Liff }).liff;
    if (!sdkLoaded || !liff) return;
    let active = true;
    initialized.current ??= Promise.resolve().then(() => {
      if (!liffId) throw new Error("ร้านยังไม่ได้ตั้งค่า LINE");
      return liff.init({ liffId });
    });
    void initialized.current.then(async () => {
      if (!active) return;
      if (!liff.isLoggedIn()) { setSdk(liff); return; }
      const idToken = liff.getIDToken();
      if (!idToken) throw new Error("LINE ไม่ได้ส่ง ID token");
      try {
        await api("/line/login", { method: "POST", body: { idToken } });
        storage()?.removeItem(RELOGIN_KEY);
      } catch (e) {
        const failure = asFailure(e);
        if (!RENEWABLE.has(failure.code) || storage()?.getItem(RELOGIN_KEY)) throw e;
        storage()?.setItem(RELOGIN_KEY, "1");
        liff.logout();
        // Keep only `next`; LINE's own callback parameters must not be replayed.
        const next = new URLSearchParams(location.search).get("next");
        liff.login({ redirectUri: `${location.origin}${location.pathname}${next ? `?next=${encodeURIComponent(next)}` : ""}` });
        return;
      }
      if (active) router.replace(`/book/${slug}/${new URLSearchParams(window.location.search).get("next") === "waiting" && loadCustomer() ? "waiting" : "details"}`);
    }).catch((e) => active && setError(e instanceof Error ? e.message : asFailure(e).message));
    return () => { active = false; };
  }, [router, sdkLoaded, slug, liffId]);

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
