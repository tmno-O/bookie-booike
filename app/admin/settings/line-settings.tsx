"use client";

import { useEffect, useState, type FormEvent } from "react";
import { adminApi, asFailure } from "../admin-api";
import LineHealth from "./line-health";
import styles from "../admin.module.css";
import page from "./settings-pages.module.css";

type Integration = { providerId: string; channelId: string; liffId: string; hasChannelSecret: boolean; hasAccessToken: boolean };
const path = "/admin/line-integration";

/** Owner-only: the Messaging API token that lets the venue push booking notices to customers on LINE. */
export default function LineSettings() {
  const [integration, setIntegration] = useState<Integration | null>();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [checkVersion, setCheckVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    adminApi<{ integration: Integration | null }>(path, { signal: controller.signal })
      .then((r) => { if (!controller.signal.aborted) setIntegration(r.integration); })
      .catch((e) => { if (!controller.signal.aborted) setError(asFailure(e).message); });
    return () => controller.abort();
  }, []);

  async function saveToken(value: string | null) {
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await adminApi<{ integration: Integration }>(path, { method: "PATCH", body: { channelAccessToken: value } });
      setIntegration(r.integration);
      setToken("");
      setCheckVersion((v) => v + 1);
      setNotice(value ? "บันทึก token แล้ว การจองถัดไปจะได้รับแจ้งเตือนทาง LINE" : "ลบ token แล้ว ระบบหยุดส่งข้อความ LINE");
    } catch (e) {
      setError(asFailure(e).message);
    } finally { setBusy(false); }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = token.trim();
    if (value && !busy) void saveToken(value);
  }

  function remove() {
    if (!busy && window.confirm("ลบ token แล้วลูกค้าจะไม่ได้รับข้อความ LINE จนกว่าจะใส่ใหม่ ต้องการลบไหม?")) void saveToken(null);
  }

  return (
    <form className={`${styles.card} ${page.bookingLink}`} onSubmit={submit} aria-labelledby="line-settings-title">
      <h2 id="line-settings-title" className={styles.cardTitle}>การแจ้งเตือน LINE</h2>
      <p className={styles.cardSub}>ใส่ channel access token ของ Messaging API channel เพื่อส่งข้อความยืนยัน ยกเลิก และเตือนก่อนถึงวันจอง</p>
      {integration === undefined && !error && <p className={page.hint}>กำลังโหลด…</p>}
      {integration !== undefined && <LineHealth version={checkVersion} />}
      {integration === null && <p className={page.hint}>ร้านยังไม่ได้เชื่อม LINE Login กรุณาตั้ง LINE Login channel และ LIFF ก่อน</p>}
      {integration && <>
        <dl className={`${page.bookingLinkFields} ${page.lineFacts}`}>
          <div><dt className={styles.fieldLabelStrong}>Provider</dt><dd>{integration.providerId}</dd></div>
          <div><dt className={styles.fieldLabelStrong}>LINE Login channel</dt><dd>{integration.channelId}</dd></div>
          <div><dt className={styles.fieldLabelStrong}>LIFF ID</dt><dd>{integration.liffId}</dd></div>
          <div><dt className={styles.fieldLabelStrong}>Messaging API token</dt>
            <dd>{integration.hasAccessToken ? "ตั้งค่าแล้ว" : "ยังไม่ได้ตั้ง · ระบบยังไม่ส่งข้อความ LINE"}</dd></div>
        </dl>
        <label className={styles.fieldLabelStrong} htmlFor="line-access-token" style={{ marginTop: 16 }}>
          {integration.hasAccessToken ? "เปลี่ยน channel access token" : "Channel access token"}
        </label>
        <input id="line-access-token" className={styles.input} type="password" value={token} maxLength={4096}
          onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} disabled={busy}
          placeholder="วาง channel access token (long-lived)" aria-describedby="line-access-token-help" />
        <p id="line-access-token-help" className={page.hint}>
          ออก token ที่ LINE Developers Console → Messaging API channel ใต้ provider เดียวกับ LINE Login → แท็บ Messaging API →
          Channel access token (long-lived). ลูกค้าต้องเพิ่ม LINE OA ของร้านเป็นเพื่อนจึงจะได้รับข้อความ. ระบบเก็บ token แบบเข้ารหัสและไม่แสดงอีก
        </p>
      </>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {integration && (
        <div className={styles.saveRow}>
          {integration.hasAccessToken && <button type="button" className={`${styles.btn} ${styles.btnOutline}`} disabled={busy}
            onClick={remove}>ลบ token</button>}
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy || !token.trim()}>
            {busy ? "กำลังตรวจกับ LINE…" : "บันทึก token"}
          </button>
        </div>
      )}
    </form>
  );
}
