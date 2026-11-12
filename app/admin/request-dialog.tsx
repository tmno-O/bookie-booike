"use client";

import { useEffect, useState } from "react";
import { adminApi, asFailure, formatPhone, PARTY_LABEL, queueDate } from "./admin-api";
import styles from "./admin.module.css";

type Row = { id: string; queueNo: number; name: string; serviceDate: string; party: string; zoneId: string; zoneName: string; status: "pending" | "allocated" };
type Zone = { id: string; name: string; available: boolean; closed?: boolean };

// Queue request details with zone allocation (Figma: รายละเอียดคำขอ #n → จัดสรรโซนแล้ว).
export default function RequestDialog({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const [request, setRequest] = useState<Row>();
  const [phone, setPhone] = useState("");
  const [zones, setZones] = useState<Zone[]>([]);
  const [chosen, setChosen] = useState("");
  const [full, setFull] = useState(false);
  const [view, setView] = useState<"details" | "done">("details");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  useEffect(() => {
    let active = true;
    adminApi<{ request: Row; phone: string; zones: Zone[] }>(`/admin/queue/${requestId}`).then((r) => {
      if (!active) return;
      setRequest(r.request); setPhone(r.phone); setZones(r.zones); setChosen(r.request.zoneId);
    }).catch((e) => active && setError(asFailure(e).status === 404 ? "ไม่พบคำขอนี้" : asFailure(e).message));
    return () => { active = false; };
  }, [requestId]);

  async function allocate() {
    if (!request) return;
    setBusy(true); setError("");
    try {
      const r = await adminApi<{ request: Row }>(`/admin/queue/${requestId}/allocate`, {
        method: "POST", body: chosen && chosen !== request.zoneId ? { zoneId: chosen } : undefined,
      });
      setRequest(r.request); setView("done");
    } catch (e) {
      const f = asFailure(e);
      if (f.code === "ZONE_FULL" || f.code === "ZONE_CLOSED" || f.code === "ZONE_NOT_FOUND") {
        setFull(true);
        setError(f.code === "ZONE_FULL" ? "โซนนี้เต็มแล้ว กรุณาเลือกโซนอื่นเพื่อจัดสรร" : f.message);
        const fresh = await adminApi<{ request: Row; zones: Zone[] }>(`/admin/queue/${requestId}`).catch(() => undefined);
        if (fresh) {
          setRequest(fresh.request);
          setZones(fresh.zones);
          setChosen(fresh.zones.find((z) => z.available)?.id ?? "");
        }
      } else {
        setError(f.message);
        if (f.code === "ALREADY_ALLOCATED") {
          const fresh = await adminApi<{ request: Row }>(`/admin/queue/${requestId}`).catch(() => undefined);
          if (fresh) setRequest(fresh.request);
        }
      }
    } finally { setBusy(false); }
  }

  const row = (label: string, value: string) => (
    <div className={styles.dRow} key={label}><span className={styles.dLabel}>{label}</span><p className={styles.dValue}>{value}</p></div>
  );
  const done = view === "done";
  const title = done ? "จัดสรรโซนแล้ว" : request ? `รายละเอียดคำขอ #${request.queueNo}` : "รายละเอียดคำขอ";
  const sub = done ? "สถานะการจองได้รับการปรับปรุง" : "ตรวจสอบคำขอและผลการจัดสรร";

  return (
    <div className={styles.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="request-title">
        <h2 id="request-title" className={styles.dialogTitle}>{title}</h2>
        <p className={styles.dialogSub}>{sub}</p>

        {!request && !error && <p className={styles.dialogSub} style={{ marginTop: 28 }}>กำลังโหลด…</p>}
        {request && !done && (
          <div className={styles.dRows}>
            {row("ลูกค้า", request.name)}
            {row("เบอร์โทรติดต่อ", formatPhone(phone))}
            {row("คืนที่จอง", queueDate(request.serviceDate))}
            {row("จำนวน / โซน", `${PARTY_LABEL[request.party]} · ${request.zoneName}`)}
            {row("สถานะ", request.status === "pending" ? "รอจัดสรร" : "จัดสรรแล้ว")}
            {full && request.status === "pending" && (
              <label className={styles.field}><span className={styles.fieldLabel}>จัดสรรไปที่โซน</span>
                <select className={styles.input} value={chosen} onChange={(e) => setChosen(e.target.value)}>
                  {zones.map((z) => <option key={z.id} value={z.id} disabled={!z.available}>{z.name}{z.available ? "" : z.closed ? " (ปิด)" : " (เต็ม)"}</option>)}
                </select></label>
            )}
          </div>
        )}
        {request && done && (
          <div className={styles.dRows}>
            {row("ลูกค้า", request.name)}
            {row("โซน", request.zoneName)}
            {row("สถานะ", "ยืนยันแล้ว")}
          </div>
        )}
        {error && <p role="alert" className={styles.dError}>{error}</p>}

        <div className={styles.dActions}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} disabled={busy}
            onClick={done ? () => setView("details") : onClose}>กลับ</button>
          {done
            ? <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onClose}>กลับไปยังรายการ</button>
            : request?.status === "pending" &&
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy || !chosen} onClick={allocate}>
                {busy ? "กำลังบันทึก…" : "จัดสรรโซน"}
              </button>}
        </div>
      </div>
    </div>
  );
}
