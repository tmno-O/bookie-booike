"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "../../admin-shell";
import { adminApi, asFailure, type Staff } from "../../admin-api";
import { SettingsHeader } from "../settings-tabs";
import styles from "../../admin.module.css";
import page from "../settings-pages.module.css";

type Hours = { openWeekdays: number[]; service: { start: string; end: string }; canEdit: boolean };

// Monday first, as in the design. Values follow Postgres/JS weekday numbers (0 = Sunday).
const DAYS = [
  { dow: 1, name: "จันทร์", short: "จ." }, { dow: 2, name: "อังคาร", short: "อ." }, { dow: 3, name: "พุธ", short: "พ." },
  { dow: 4, name: "พฤหัสบดี", short: "พฤ." }, { dow: 5, name: "ศุกร์", short: "ศ." }, { dow: 6, name: "เสาร์", short: "ส." },
  { dow: 0, name: "อาทิตย์", short: "อา." },
];

// The venue has one service window, so it runs past midnight whenever it ends at or before it starts.
const nextDay = (start: string, end: string) => end <= start;

/** 24-hour HH:MM field (a native time input follows the OS locale and shows AM/PM). */
function TimeField({ value, label, disabled, onCommit }: { value: string; label: string; disabled: boolean; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState<string>();
  const commit = () => {
    const m = /^(\d{1,2})[:.](\d{2})$/.exec((draft ?? value).trim());
    if (m && +m[1] < 24 && +m[2] < 60) onCommit(`${m[1].padStart(2, "0")}:${m[2]}`);
    setDraft(undefined);
  };
  return (
    <input className={page.time} inputMode="numeric" maxLength={5} placeholder="HH:MM" aria-label={label} disabled={disabled}
      value={draft ?? value} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commit())} />
  );
}

/** Consecutive open days as "จ.–พฤ." / "ศ." for the customer preview. */
function dayRanges(open: number[]) {
  const runs: string[] = [];
  let from = -1;
  DAYS.forEach((day, i) => {
    const on = open.includes(day.dow);
    if (on && from < 0) from = i;
    if ((!on || i === DAYS.length - 1) && from >= 0) {
      const to = on ? i : i - 1;
      runs.push(from === to ? DAYS[from].short : `${DAYS[from].short}–${DAYS[to].short}`);
      from = -1;
    }
  });
  return runs;
}

// Staff service hours (Figma "Admin · 06a · เวลาเปิด–ปิดร้าน", node 294:403)
export default function HoursSettingsScreen() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff>();
  const [loaded, setLoaded] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [open, setOpen] = useState<number[]>([]);
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("02:00");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => adminApi<Hours>("/admin/hours").then((r) => {
    setOpen(r.openWeekdays); setStart(r.service.start); setEnd(r.service.end); setCanEdit(r.canEdit); setLoaded(true); setError("");
  }).catch((e) => {
    const failure = asFailure(e);
    if (failure.status === 401) router.replace("/admin/login");
    else setError(failure.code === "FORBIDDEN" ? "เฉพาะเจ้าของร้านที่จัดการเวลาเปิด–ปิดร้านได้" : failure.message);
  }), [router]);

  useEffect(() => {
    let active = true;
    adminApi<{ staff: Staff }>("/admin/me").then((r) => active && setStaff(r.staff))
      .catch((e) => active && asFailure(e).status === 401 && router.replace("/admin/login"));
    const first = setTimeout(() => void load(), 0);
    return () => { active = false; clearTimeout(first); };
  }, [load, router]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const toggle = (dow: number) => setOpen((days) => days.includes(dow) ? days.filter((d) => d !== dow) : [...days, dow].sort());

  async function save() {
    if (!start || !end) return setError("กรุณากรอกเวลาเปิดและเวลาปิด");
    if (start === end) return setError("เวลาเปิดและเวลาปิดต้องไม่เท่ากัน");
    setBusy(true); setError("");
    try {
      await adminApi("/admin/hours/service", { method: "PUT", body: { openWeekdays: open, serviceStart: start, serviceEnd: end } });
      setNotice("บันทึกการเปลี่ยนแปลงแล้ว");
    } catch (e) {
      const failure = asFailure(e);
      setError(failure.status === 400 ? "ข้อมูลไม่ถูกต้อง ตรวจสอบเวลาเปิดและเวลาปิด" : failure.message);
    } finally { setBusy(false); }
  }

  const ranges = dayRanges(open);
  const closedDays = DAYS.filter((d) => !open.includes(d.dow));
  const wraps = nextDay(start, end);

  return (
    <AdminShell active="/admin/settings" staff={staff}>
      <SettingsHeader tab="hours" canSave={canEdit} busy={busy} onSave={save} />
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}

      <div className={page.split}>
        <section className={styles.card} aria-labelledby="week-title">
          <h2 id="week-title" className={styles.cardTitle} style={{ fontSize: 24, marginTop: 8 }}>เวลาเปิด–ปิดประจำสัปดาห์</h2>
          <hr className={page.divider} style={{ marginTop: 28 }} />
          <div className={page.week} role="table" aria-label="เวลาเปิด–ปิดร้านแต่ละวัน">
            <div className={page.weekHead} role="row">
              <span role="columnheader">วันให้บริการ</span><span role="columnheader">สถานะ</span>
              <span role="columnheader">เวลาเปิด</span><span /><span role="columnheader">เวลาปิด</span><span />
            </div>
            {!loaded && !error && <p className={styles.hintLine} style={{ paddingBlock: 20 }}>กำลังโหลด…</p>}
            {loaded && DAYS.map(({ dow, name }) => {
              const on = open.includes(dow);
              return (
                <div key={dow} className={page.weekRow} role="row">
                  <span className={page.day} role="cell">{name}</span>
                  <span className={page.statusCell} role="cell">
                    <button type="button" role="switch" aria-checked={on} aria-label={`${name} ${on ? "เปิด" : "ปิด"}`}
                      className={`${page.switch} ${on ? page.switchOn : ""}`} disabled={!canEdit || busy || !loaded} onClick={() => toggle(dow)} />
                    {on ? "เปิด" : "ปิด"}
                  </span>
                  {on ? (
                    <>
                      <TimeField value={start} label={`${name} เวลาเปิด`} disabled={!canEdit || busy} onCommit={setStart} />
                      <span className={page.dash} aria-hidden="true">–</span>
                      <TimeField value={end} label={`${name} เวลาปิด`} disabled={!canEdit || busy} onCommit={setEnd} />
                      <span className={page.nextDay}>{wraps ? "วันถัดไป" : ""}</span>
                    </>
                  ) : <span className={page.closedText} role="cell">ไม่เปิดให้บริการ</span>}
                </div>
              );
            })}
          </div>
          {loaded && <p className={styles.hintLine} style={{ marginTop: 18 }}>ระบบใช้เวลาเปิด–ปิดเดียวกันทุกวันที่เปิดให้บริการ แก้เวลาวันใดวันหนึ่งแล้วทุกวันจะเปลี่ยนตาม</p>}
        </section>

        <aside className={styles.card} aria-labelledby="preview-title">
          <h2 id="preview-title" className={page.previewTitle}>ข้อมูลที่ลูกค้าเห็น</h2>
          <p className={page.previewLabel}>เวลาให้บริการ</p>
          {ranges.map((range) => (
            <p key={range} className={page.previewLine}><span>{range}</span><span>{start}–{end}</span></p>
          ))}
          {loaded && closedDays.length > 0 && (
            <p className={`${page.previewLine} ${page.previewMuted}`}>
              <span>{closedDays.map((d) => d.name).join(", ")}</span><span>ปิด</span>
            </p>
          )}
          {loaded && !open.length && <p className={`${page.previewLine} ${page.previewMuted}`}>ไม่เปิดให้บริการ</p>}
          <hr className={styles.divLine} />
          <p className={styles.cardSub} style={{ fontSize: 13, marginTop: 0 }}>เวลาปิดหลังเที่ยงคืนคือวันถัดไป</p>
        </aside>
      </div>

      <p className={page.note}>เวลานี้คือเวลาให้บริการของร้าน เวลาเปิดรับจองตั้งค่าแยกในเมนู “เวลาเปิดจอง”</p>
    </AdminShell>
  );
}
