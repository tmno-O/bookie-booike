"use client";

import Link from "next/link";
import { waitForBooking } from "@/client/booking-result";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import type { FloorPlan } from "@/lib/floor-plan";
import FloorPlanView from "@/ui/floor-plan-view";
import { api, asFailure, realApiMode, thaiDate } from "../flow";
import styles from "./select.module.css";

const PARTIES = [{ label: "1–4", value: "1-4" }, { label: "5–8", value: "5-8" }, { label: "9–12", value: "9-12" }, { label: "12+", value: "12+" }];
type Zone = { id: string; name: string; tablesLeft: number; available: boolean; closed?: boolean };
const MAP_ZONES = ["VIP", "Indoor", "Outdoor"];
type NightInfo = { zones: Zone[]; open: boolean; opensAt: string; closed?: boolean };
const openText = (iso: string) =>
  new Intl.DateTimeFormat("th-TH-u-ca-gregory", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" }).format(new Date(iso));
type Venue = { today: string; maxAdvanceDays: number; openWeekdays: number[]; largePartyMode?: "staff_review" | "disabled";
  closedDates: { serviceDate: string; reason: string }[]; shop?: { name: string; entryPolicy: string } };

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// Step 4 of 4 — pick night, party size and zone (Figma "04 · เลือกคืน จำนวนคน และโซน", node 169:388)
export default function SelectForm({ slug }: { slug: string }) {
  const router = useRouter();
  const requestId = useSearchParams().get("r");
  const [venue, setVenue] = useState<Venue>();
  const [date, setDate] = useState("");
  const [party, setParty] = useState(0);
  const [zones, setZones] = useState<Zone[]>([]);
  const [night, setNight] = useState<{ open: boolean; opensAt: string; closed?: boolean }>({ open: true, opensAt: "" });
  const [zoneId, setZoneId] = useState<string>();
  const [plan, setPlan] = useState<FloorPlan | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [returnTo, setReturnTo] = useState<"waiting" | "queue">();
  const availabilityPath = `/availability?date=${date}${realApiMode ? `&partyBucket=${encodeURIComponent(PARTIES[party].value)}` : ""}`;

  // Only customers whose queue turn has arrived may pick a night.
  useEffect(() => {
    if (!requestId) { router.replace(`/book/${slug}/waiting`); return; }
    const controller = new AbortController();
    Promise.all([
      api<{ status: string; bookingId?: string; bookingRequestId?: string }>(`/queue/${requestId}`, { signal: controller.signal }),
      api<Venue>("/venue", { signal: controller.signal }),
    ]).then(async ([queue, v]) => {
      if (controller.signal.aborted) return;
      if (queue.bookingId) router.replace(`/book/${slug}/confirmed?b=${queue.bookingId}`);
      else if (queue.status === "waiting") router.replace(`/book/${slug}/queue?r=${requestId}`);
      else if (queue.status === "expired") router.replace(`/book/${slug}/waiting`);
      else if (queue.status === "used" && queue.bookingRequestId) {
        setBusy(true);
        const { booking } = await waitForBooking(`/api/me/booking-requests/${queue.bookingRequestId}`, controller.signal, true);
        if (!controller.signal.aborted) router.replace(`/book/${slug}/confirmed?b=${booking.id}`);
      } else { setVenue(v); setDate(v.today); }
    }).catch((e) => {
      if (controller.signal.aborted) return;
      const failure = asFailure(e);
      if (failure.status === 404) router.replace(`/book/${slug}/waiting`);
      else {
        setError(failure.code === "ZONE_FULL" ? "โซนนี้เต็มแล้ว กรุณารับคิวใหม่" : failure.message);
        setBusy(false);
        if (failure.ticketUsed) setReturnTo(failure.code === "BOOKING_PROCESSING" ? "queue" : "waiting");
      }
    });
    return () => { controller.abort(); };
  }, [requestId, router, slug]);

  // The shop's published floor plan; without one the built-in map below is shown.
  useEffect(() => {
    if (!venue) return;
    let active = true;
    api<{ plan: FloorPlan | null }>("/floor-plan").then((r) => { if (active) setPlan(r.plan); }).catch(() => undefined);
    return () => { active = false; };
  }, [venue]);

  const loadZones = () => api<NightInfo>(availabilityPath)
    .then((r) => { setZones(r.zones); setNight({ open: r.open, opensAt: r.opensAt, closed: r.closed }); return r.zones; });
  useEffect(() => {
    if (!date) return;
    let active = true;
    api<NightInfo>(availabilityPath)
      .then((r) => { if (active) { setZones(r.zones); setNight({ open: r.open, opensAt: r.opensAt, closed: r.closed }); } }).catch((e) => active && setError(asFailure(e).message));
    return () => { active = false; };
  }, [availabilityPath, date]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!zoneId || !requestId) return;
    setBusy(true); setError("");
    try {
      const { booking } = await api<{ booking: { id: string } }>("/bookings", {
        method: "POST", body: { requestId, serviceDate: date, party: PARTIES[party].value, zoneId },
      });
      router.push(`/book/${slug}/confirmed?b=${booking.id}`);
    } catch (e) {
      const failure = asFailure(e);
      setError(failure.code === "ZONE_FULL" ? "โซนนี้เต็มแล้ว กรุณาเลือกโซนอื่น" : failure.code === "NIGHT_NOT_OPEN" ? "คืนนี้ยังไม่เปิดรับจอง" : failure.message);
      setBusy(false);
      if (failure.ticketUsed || failure.code === "TICKET_NOT_READY") {
        setZoneId(undefined);
        setReturnTo(failure.code === "BOOKING_PROCESSING" ? "queue" : "waiting");
      } else if (failure.code === "ZONE_FULL" || failure.code === "ZONE_CLOSED") {
        setZoneId(undefined);
        void loadZones().catch((error) => setError(asFailure(error).message));
      }
    }
  }

  const closureReason = (day: string) => {
    const closure = venue?.closedDates.find((c) => c.serviceDate === day);
    if (closure) return closure.reason || "ร้านปิด";
    if (venue && !venue.openWeekdays.includes(new Date(`${day}T00:00:00Z`).getUTCDay())) return "วันหยุดประจำสัปดาห์";
    return null;
  };
  const closed = night.closed || !!closureReason(date);
  const zoneButton = (name: string, className = "") => {
    const zone = zones.find((z) => z.name === name);
    const full = zone ? !zone.available : false;
    const selected = !!zone && zoneId === zone.id;
    return (
      <button type="button" key={name} aria-pressed={selected} disabled={!zone || full || !night.open || closed || busy || !!returnTo}
        className={`${styles.zone} ${className} ${selected ? styles.zoneOn : ""} ${full ? styles.zoneFull : ""}`}
        onClick={() => zone && setZoneId(zone.id)}>
        {name}{full && <span className={styles.full}>{zone?.closed ? "ปิด" : "เต็ม"}</span>}
      </button>
    );
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.body}>
        <p className={styles.step}>ขั้นตอน 4 จาก 4</p>
        <h1 className={styles.title}>เลือกคืนและโซน</h1>
        <p className={styles.subtitle}>เลือกวันที่ จำนวนคน และพื้นที่ที่ต้องการ</p>

        <label className={styles.label} htmlFor="date">คืนที่ต้องการ</label>
        <div className={styles.dateField}>
          <span>{date ? thaiDate(date) : "กำลังโหลด…"}</span><span className={styles.chev} aria-hidden>⌄</span>
          {venue && <select id="date" className={styles.dateInput} value={date} disabled={busy || !!returnTo}
            onChange={(e) => { setDate(e.target.value); setZoneId(undefined); setZones([]); }}>
            {Array.from({ length: venue.maxAdvanceDays + 1 }, (_, i) => addDays(venue.today, i)).map((day) =>
              <option key={day} value={day} disabled={!!closureReason(day)}>{thaiDate(day)}{closureReason(day) ? ` · ร้านปิด: ${closureReason(day)}` : ""}</option>)}
          </select>}
        </div>

        <span className={styles.label} id="party-label">จำนวนผู้เข้าร่วม</span>
        <div className={styles.party} role="group" aria-labelledby="party-label">
          {PARTIES.map((p, i) => venue?.largePartyMode === "disabled" && p.value === "12+" ? null : (
            <button type="button" key={p.value} aria-pressed={party === i}
              className={`${styles.pill} ${party === i ? styles.pillOn : ""}`} disabled={busy || !!returnTo}
              onClick={() => { if (party !== i) { setParty(i); setZoneId(undefined); if (realApiMode) setZones([]); } }}>{p.label}</button>
          ))}
        </div>
        {venue?.largePartyMode === "disabled" && <p className={styles.caption}>กลุ่มเกิน 12 คน กรุณาติดต่อร้านโดยตรง</p>}
        {PARTIES[party].value === "12+" && <p className={styles.caption}>กลุ่มเกิน 12 คน ร้านจะยืนยันและจัดโต๊ะให้ภายหลัง</p>}

        <span className={styles.label} id="zone-label">โซนที่ต้องการ</span>
        {plan?.zones.length ? (
          <>
            <div role="group" aria-labelledby="zone-label">
              <FloorPlanView plan={plan} selectedId={zoneId} onSelect={setZoneId}
                zones={Object.fromEntries(zones.map((z) => [z.id, {
                  name: z.name, badge: z.available ? undefined : z.closed ? "ปิด" : "เต็ม",
                  disabled: !z.available || !night.open || closed || busy || !!returnTo,
                }]))} />
            </div>
            {zones.some((z) => !plan.zones.some((shape) => shape.zoneId === z.id)) && (
              <div className={styles.row} style={{ flexWrap: "wrap", marginTop: 12 }}>
                {zones.filter((z) => !plan.zones.some((shape) => shape.zoneId === z.id)).map((z) => zoneButton(z.name))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className={styles.map} role="group" aria-labelledby="zone-label">
              <span className={`${styles.mapNote} ${styles.stage}`}>เวที</span>
              {zoneButton("VIP", styles.vip)}
              <div className={styles.row}>{zoneButton("Indoor")}{zoneButton("Outdoor")}</div>
              <span className={`${styles.mapNote} ${styles.entrance}`}>↑ ทางเข้า</span>
            </div>
            {zones.some((z) => !MAP_ZONES.includes(z.name)) && (
              <div className={styles.row} style={{ flexWrap: "wrap", marginTop: 12 }}>
                {zones.filter((z) => !MAP_ZONES.includes(z.name)).map((z) => zoneButton(z.name))}
              </div>
            )}
          </>
        )}
        {closed && <p role="status" className={styles.error}>ร้านปิด · {closureReason(date) || "คืนนี้ปิดรับจอง"}</p>}
        {!closed && !night.open && night.opensAt && <p role="status" className={styles.error} style={{ color: "#b94e29" }}>คืนนี้ยังไม่เปิดรับจอง · เปิดรับจอง {openText(night.opensAt)} น.</p>}
        <p className={styles.hint}>แตะพื้นที่บนผังเพื่อเลือกโซน</p>
        {venue?.shop?.entryPolicy && <p className={styles.caption} style={{ marginTop: 16, fontSize: 12 }}>นโยบายการเข้าร้าน: {venue.shop.entryPolicy}</p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </div>
      <div className={styles.footer}>
        {returnTo ? (
          <Link className={styles.cta} href={returnTo === "queue" ? `/book/${slug}/queue?r=${requestId}` : `/book/${slug}/waiting`}>
            {returnTo === "queue" ? "ดูสถานะคำขอ" : "กลับไปรับคิวใหม่"}
          </Link>
        ) : (
          <button type="submit" className={styles.cta} disabled={!zoneId || !night.open || closed || busy}>
            {busy ? "กำลังจอง…" : zoneId ? "ยืนยันการจอง" : "เลือกโซนเพื่อดำเนินการต่อ"}
          </button>
        )}
      </div>
    </form>
  );
}
