"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi, asFailure } from "../admin-api";
import styles from "../admin.module.css";
import page from "./settings-pages.module.css";

type Status = "ok" | "warn" | "fail" | "unknown";
type Check = { id: string; status: Status; title: string; detail: string; fix?: string };
type Report = { ready: boolean; checks: Check[]; bot: { name: string | null; basicId: string | null; addFriendUrl: string | null } | null };

const mark: Record<Status, { icon: string; label: string }> = {
  ok: { icon: "✓", label: "ผ่าน" },
  warn: { icon: "!", label: "ควรแก้" },
  fail: { icon: "✕", label: "ต้องแก้" },
  unknown: { icon: "?", label: "ตรวจไม่ได้" },
};

const fetchReport = (signal?: AbortSignal) => adminApi<Report>("/admin/line-integration/health", { signal });

/** Runs the server's LINE checklist and shows each step with how to fix it. `version` re-runs it after a save. */
export default function LineHealth({ version }: { version: number }) {
  const [report, setReport] = useState<Report>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const show = useCallback((signal?: AbortSignal) => fetchReport(signal).then((result) => {
    if (signal?.aborted) return;
    setReport(result); setError("");
  }).catch((e) => {
    if (!signal?.aborted) setError(asFailure(e).message);
  }).finally(() => {
    if (!signal?.aborted) setBusy(false);
  }), []);

  useEffect(() => {
    const controller = new AbortController();
    void show(controller.signal);
    return () => controller.abort();
  }, [show, version]);

  async function copyFriendLink(url: string) {
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); }
  }

  const count = (status: Status) => report?.checks.filter((check) => check.status === status).length ?? 0;
  return (
    <section className={page.lineHealth} aria-labelledby="line-health-title" aria-busy={busy}>
      <div className={page.lineHealthHead}>
        <h3 id="line-health-title" className={page.lineHealthTitle}>ตรวจความพร้อมการแจ้งเตือน</h3>
        <button type="button" className={`${styles.btn} ${styles.btnOutline}`} onClick={() => { setBusy(true); void show(); }} disabled={busy}>
          {busy ? "กำลังตรวจ…" : "ตรวจอีกครั้ง"}
        </button>
      </div>
      {report && (
        <p role="status" className={`${page.lineSummary} ${report.ready ? page.lineSummaryOk : page.lineSummaryBad}`}>
          {report.ready
            ? `พร้อมส่งแจ้งเตือน LINE ให้ลูกค้า${count("warn") ? ` · มีข้อแนะนำ ${count("warn")} ข้อ` : ""}`
            : `ยังไม่พร้อม · ต้องแก้ ${count("fail")} ข้อ ตามคำแนะนำด้านล่าง`}
        </p>
      )}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {report && (
        <ol className={page.lineChecks}>
          {report.checks.map((check) => (
            <li key={check.id} className={`${page.lineCheck} ${page[`line_${check.status}`]}`}>
              <span className={page.lineMark} aria-label={mark[check.status].label}>{mark[check.status].icon}</span>
              <div>
                <p className={page.lineCheckTitle}>{check.title} <span className={page.lineCheckState}>· {mark[check.status].label}</span></p>
                <p className={page.lineCheckDetail}>{check.detail}</p>
                {check.fix && (check.status === "fail" || check.status === "warn") && <p className={page.lineFix}>วิธีแก้: {check.fix}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {report?.bot?.addFriendUrl && (
        <div className={page.lineFriend}>
          <p className={page.lineCheckDetail}>ลิงก์เพิ่มเพื่อน {report.bot.name ?? "OA"} ใส่ใน Rich Menu, โพสต์ หรือป้ายหน้าร้าน ลูกค้าจะได้รับข้อความ LINE</p>
          <div className={styles.saveRow}>
            <a className={`${styles.btn} ${styles.btnOutline}`} href={report.bot.addFriendUrl} target="_blank" rel="noreferrer">เปิดลิงก์เพิ่มเพื่อน</a>
            <button type="button" className={`${styles.btn} ${styles.btnOutline}`} onClick={() => void copyFriendLink(report.bot!.addFriendUrl!)}>
              {copied ? "คัดลอกแล้ว" : "คัดลอกลิงก์"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
