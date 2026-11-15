"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AuditEntry } from "@/contracts/audit";
import { exportAuditCsv } from "@/client/staff-api";
import { bangkokDate } from "@/lib/service-date";
import { adminApi, asFailure, type Staff } from "../admin-api";
import { AdminShell } from "../admin-shell";
import { AuditTable } from "./audit-table";
import styles from "../admin.module.css";

type Page = { entries: AuditEntry[]; nextOffset: number | null; simulated?: boolean };
type Verification = { valid: boolean; checked: number; firstBadSeq: string | null; headHash: string | null; lastSeq: string | null; simulated?: boolean };

export default function AuditScreen() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff>();
  const [date, setDate] = useState(bangkokDate);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page>();
  const [verification, setVerification] = useState<Verification>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const params = new URLSearchParams({ date, q: query, offset: String(offset) }).toString();
  const failure = useCallback((e: unknown) => {
    if (asFailure(e).status === 401) router.replace("/admin/login"); else setError(asFailure(e).message);
  }, [router]);
  useEffect(() => { adminApi<{ staff: Staff }>("/admin/me").then((r) => setStaff(r.staff)).catch(failure); }, [failure]);
  useEffect(() => {
    if (!date) return;
    const controller = new AbortController();
    adminApi<Page>(`/admin/audit?${params}`, { signal: controller.signal }).then((r) => { setPage(r); setError(""); })
      .catch((e) => { if (!controller.signal.aborted) failure(e); });
    return () => controller.abort();
  }, [date, params, failure]);
  function submit(e: FormEvent) { e.preventDefault(); setOffset(0); setQuery(search.trim()); }
  async function verify() {
    setBusy(true); setError("");
    try { setVerification(await adminApi<Verification>("/admin/audit/verify")); } catch (e) { failure(e); }
    finally { setBusy(false); }
  }
  async function download() {
    setBusy(true); setError("");
    try {
      const blob = await exportAuditCsv(new URLSearchParams({ date, q: query }).toString());
      const url = URL.createObjectURL(blob), anchor = document.createElement("a");
      anchor.href = url; anchor.download = `booking-audit-${date}.csv`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e instanceof Error ? e.message : asFailure(e).message); } finally { setBusy(false); }
  }
  return <AdminShell active="/admin/audit" staff={staff}>
    <h1 className={styles.h1}>หลักฐานคิวและการจอง</h1>
    <p className={styles.sub}>เลข ticket ไม่ซ้ำจาก identity และ unique constraint · หนึ่งโต๊ะต่อคืนมี allocation active ได้หนึ่งรายการ · DB ล็อกการตัดสินต่อร้าน/คืน</p>
    <p>ตำแหน่งคิวบนหน้าลูกค้าเปลี่ยนตามเวลา สิทธิ์จองตรวจด้วยเลขอ้างอิงและรหัสตรวจสอบ</p>
    {page?.simulated && <p className={styles.notice}>โหมดจำลอง · ข้อมูลนี้ไม่ใช่หลักฐานจากฐานข้อมูลจริง</p>}
    <form className={styles.actions} onSubmit={submit} style={{ flexWrap: "wrap", marginBlock: 24 }}>
      <label>คืนบริการ<input className={styles.input} type="date" value={date} onChange={(e) => { setDate(e.target.value); setOffset(0); }} /></label>
      <label>เลขอ้างอิง / เบอร์ 4 ตัวท้าย<input className={styles.input} value={search} maxLength={80} onChange={(e) => setSearch(e.target.value)} /></label>
      <button className={`${styles.btn} ${styles.btnOutline}`} type="submit">ค้นหา</button>
      <button className={`${styles.btn} ${styles.btnPrimary}`} type="button" disabled={busy} onClick={verify}>ตรวจความถูกต้องทั้งร้าน</button>
      {staff?.role === "owner" && <button className={`${styles.btn} ${styles.btnOutline}`} type="button" disabled={busy || !date} onClick={download}>ส่งออก CSV</button>}
    </form>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {verification && <div role="status" className={verification.valid ? styles.notice : styles.error}>
      {verification.simulated ? "ผลจำลอง" : verification.valid ? "Hash chain ตรงกัน" : `พบหลักฐานเปลี่ยนแปลงที่ seq ${verification.firstBadSeq}`} · ตรวจ {verification.checked} แถว
      {verification.headHash && <details><summary>จุดตรวจสอบล่าสุด seq {verification.lastSeq}</summary><code style={{ overflowWrap: "anywhere" }}>{verification.headHash}</code></details>}
      <p>ผลตรวจอ้างอิง chain ที่เก็บอยู่ ผู้ดูแล DB ที่เขียน chain ใหม่ทั้งชุดต้องตรวจเทียบสำเนาภายนอก</p>
    </div>}
    {page ? <AuditTable entries={page.entries} /> : <p role="status">กำลังโหลดหลักฐาน…</p>}
    <div className={styles.actions} style={{ marginTop: 24 }}>
      <button className={styles.btn} disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>ก่อนหน้า</button>
      <button className={styles.btn} disabled={page?.nextOffset == null} onClick={() => setOffset(page!.nextOffset!)}>ถัดไป</button>
    </div>
  </AdminShell>;
}
