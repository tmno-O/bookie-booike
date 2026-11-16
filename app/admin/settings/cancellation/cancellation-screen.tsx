"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "../../admin-shell";
import { adminApi, asFailure, type Staff } from "../../admin-api";
import { SettingsHeader } from "../settings-tabs";
import styles from "../../admin.module.css";
import page from "../settings-pages.module.css";

type Unit = "hours" | "days";
const MINUTES = { hours: 60, days: 1440 } as const;
const UNIT_LABEL = { hours: "ชั่วโมง", days: "วัน" } as const;
const QUICK = [1, 3, 5];
const MAX_MINUTES = 525600;

/** Whole days show as days; anything else shows as (possibly fractional) hours. */
function fromMinutes(minutes: number): { value: string; unit: Unit } {
  if (minutes > 0 && minutes % MINUTES.days === 0) return { value: String(minutes / MINUTES.days), unit: "days" };
  return { value: String(Math.round((minutes / MINUTES.hours) * 100) / 100), unit: "hours" };
}

// Staff cancellation rule (Figma "Admin · 06b · การยกเลิก · ชั่วโมง" 294:554 and "06c · วัน" 294:647)
export default function CancellationScreen() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff>();
  const [loaded, setLoaded] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState<Unit>("hours");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => adminApi<{ cancelCutoffMinutes: number; canEdit: boolean }>("/admin/settings").then((r) => {
    const parsed = fromMinutes(r.cancelCutoffMinutes);
    setValue(parsed.value); setUnit(parsed.unit); setCanEdit(r.canEdit); setLoaded(true); setError("");
  }).catch((e) => {
    const failure = asFailure(e);
    if (failure.status === 401) router.replace("/admin/login");
    else setError(failure.code === "FORBIDDEN" ? "เฉพาะเจ้าของร้านที่จัดการเงื่อนไขการยกเลิกได้" : failure.message);
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

  const amount = value.trim() === "" ? NaN : Number(value);
  const minutes = Math.round(amount * MINUTES[unit]);
  const invalid = !Number.isFinite(amount) || amount < 0 || minutes > MAX_MINUTES;

  async function save() {
    if (invalid) return setError(`กรุณากรอกจำนวน${UNIT_LABEL[unit]}ตั้งแต่ 0 ถึง ${MAX_MINUTES / MINUTES[unit]}`);
    setBusy(true); setError("");
    try {
      const r = await adminApi<{ cancelCutoffMinutes: number }>("/admin/settings", { method: "PATCH", body: { cancelCutoffMinutes: minutes } });
      const parsed = fromMinutes(r.cancelCutoffMinutes ?? minutes);
      setValue(parsed.value); setUnit(parsed.unit);
      setNotice("บันทึกการเปลี่ยนแปลงแล้ว");
    } catch (e) {
      const failure = asFailure(e);
      setError(failure.status === 400 ? "ค่าที่กรอกไม่ถูกต้อง" : failure.message);
    } finally { setBusy(false); }
  }

  const locked = !canEdit || busy || !loaded;
  const shown = Number.isFinite(amount) && amount >= 0 ? value.trim() : "–";

  return (
    <AdminShell active="/admin/settings" staff={staff}>
      <SettingsHeader tab="cancellation" canSave={canEdit} busy={busy} onSave={save} />
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}

      <div className={page.split}>
        <section className={styles.card} aria-labelledby="cancel-title">
          <h2 id="cancel-title" className={styles.cardTitle} style={{ fontSize: 20 }}>เงื่อนไขการยกเลิกการจอง</h2>
          <p className={styles.cardSub} style={{ fontSize: 13 }}>กำหนดระยะเวลาก่อนเริ่มการจองที่ลูกค้าสามารถยกเลิกได้</p>
          <hr className={page.divider} />

          <label className={page.fieldTitle} htmlFor="cancel-amount" style={{ display: "block" }}>ยกเลิกก่อนเวลาเริ่มการจองอย่างน้อย</label>
          <div className={page.amountRow}>
            <input id="cancel-amount" className={page.amount} type="number" inputMode="decimal" min={0} step={unit === "hours" ? 0.5 : 1}
              value={value} disabled={locked} onChange={(e) => setValue(e.target.value)} aria-invalid={loaded && invalid} />
            {(Object.keys(UNIT_LABEL) as Unit[]).map((u) => (
              <button key={u} type="button" aria-pressed={unit === u} disabled={locked}
                className={`${page.unit} ${unit === u ? page.unitOn : ""}`} onClick={() => setUnit(u)}>{UNIT_LABEL[u]}</button>
            ))}
          </div>

          <p className={page.quickLabel}>เลือกค่าที่ใช้บ่อย</p>
          <div className={page.quick}>
            {QUICK.map((n) => (
              <button key={n} type="button" className={page.quickBtn} disabled={locked} onClick={() => setValue(String(n))}>
                {n} {UNIT_LABEL[unit]}
              </button>
            ))}
          </div>
          <p className={page.hint}>หรือระบุจำนวนที่ต้องการในช่องด้านบน</p>
        </section>

        <aside className={styles.card} aria-labelledby="customer-title">
          <h2 id="customer-title" className={page.previewTitle}>ข้อความสำหรับลูกค้า</h2>
          <p className={page.customerLead}>คุณสามารถยกเลิกการจองได้</p>
          <p className={page.customerText}>ก่อนเวลาเริ่มการจองอย่างน้อย</p>
          <p className={page.customerValue} aria-live="polite"><strong>{shown}</strong><span>{UNIT_LABEL[unit]}</span></p>
          <hr className={styles.divLine} />
          <p className={styles.cardSub} style={{ fontSize: 13, marginTop: 0 }}>หากพ้นกำหนด กรุณาติดต่อร้านโดยตรง</p>
        </aside>
      </div>
    </AdminShell>
  );
}
