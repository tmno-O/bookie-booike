"use client";

import Image from "next/image";
import { useEffect, useState, type FormEvent } from "react";
import { slug as venueSlug } from "@/contracts/common";
import { adminApi, asFailure } from "../admin-api";
import styles from "../admin.module.css";
import page from "./settings-pages.module.css";

type BookingLink = { slug: string; webUrl: string; webQrSvg: string; url: string | null };
const fetchLink = (signal?: AbortSignal) => adminApi<BookingLink>("/admin/booking-link", { signal });

export default function BookingLinkSettings() {
  const [link, setLink] = useState<BookingLink>();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetchLink(controller.signal).then((saved) => {
      if (!controller.signal.aborted) { setLink(saved); setDraft(saved.slug); }
    }).catch((e) => { if (!controller.signal.aborted) setError(asFailure(e).message); });
    return () => controller.abort();
  }, []);

  const parsed = venueSlug.safeParse(draft);
  const dirty = draft !== link?.slug;
  const preview = link && parsed.success ? new URL(`/book/${parsed.data}`, link.webUrl).href : "";

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!parsed.success || !dirty || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await adminApi("/admin/settings", { method: "PATCH", body: { slug: parsed.data } });
      const saved = await fetchLink();
      setLink(saved); setDraft(saved.slug);
      setNotice("บันทึกรหัสร้านแล้ว");
    } catch (e) {
      const failure = asFailure(e);
      setError(failure.code === "SLUG_TAKEN" ? "รหัสร้านนี้ถูกใช้แล้ว กรุณาเลือกรหัสอื่น" : failure.message);
    } finally { setBusy(false); }
  }

  async function copy() {
    if (!link || dirty) return;
    try {
      await navigator.clipboard.writeText(link.webUrl);
      setNotice("คัดลอกลิงก์แล้ว"); setError("");
    } catch { setError("คัดลอกอัตโนมัติไม่สำเร็จ กรุณาคัดลอกจากช่องลิงก์"); }
  }

  return (
    <form className={`${styles.card} ${page.bookingLink}`} onSubmit={save} aria-labelledby="booking-link-title">
      <h2 id="booking-link-title" className={styles.cardTitle}>ลิงก์จองสำหรับ LINE Rich Menu</h2>
      <p className={styles.cardSub}>นำลิงก์เว็บไปตั้งใน Rich Menu หรือให้ลูกค้าสแกน QR</p>
      <div className={page.bookingLinkFields}>
        <div>
          <label className={styles.fieldLabelStrong} htmlFor="venue-slug">รหัสร้านในลิงก์จอง</label>
          <input id="venue-slug" className={styles.input} value={draft} onChange={(e) => setDraft(e.target.value)}
            maxLength={80} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy || !link}
            aria-invalid={!!link && !parsed.success} aria-describedby="venue-slug-help" />
          <p id="venue-slug-help" className={page.hint}>ใช้ a–z, 0–9 และขีดคั่น เช่น bookie-demo</p>
        </div>
        {link && <div>
          <label className={styles.fieldLabelStrong} htmlFor="venue-booking-url">ลิงก์เว็บ{dirty ? " (ตัวอย่าง)" : ""}</label>
          <input id="venue-booking-url" className={styles.input} value={preview} readOnly />
        </div>}
      </div>
      {dirty && link?.url && <p className={page.hint}>เมื่อเปลี่ยนรหัสร้าน ให้แก้ LIFF Endpoint URL เป็นลิงก์เว็บใหม่ตามด้วย /login และเปลี่ยนลิงก์ใน Rich Menu เดิม</p>}
      {link && !dirty && <Image className={page.bookingQr} src={`data:image/svg+xml,${encodeURIComponent(link.webQrSvg)}`}
        alt="QR สำหรับเปิดหน้าจอง" width={144} height={144} unoptimized />}
      {link?.url && <p className={page.hint}><a href={link.url}>ลิงก์ LIFF</a></p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      <div className={styles.saveRow}>
        <button type="button" className={`${styles.btn} ${styles.btnOutline}`} disabled={!link || dirty || busy}
          onClick={() => void copy()}>คัดลอกลิงก์</button>
        <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!link || !dirty || !parsed.success || busy}>บันทึกรหัสร้าน</button>
      </div>
    </form>
  );
}
