"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { serviceDate } from "@/contracts/common";
import type { FloorPlan } from "@/lib/floor-plan";
import FloorPlanView from "@/ui/floor-plan-view";
import { ActiveBookingNotice, useActiveBooking } from "../active-booking";
import { api, asFailure, loadCustomer, readAttempt, saveAttempt, thaiDate, type BookingAttempt, type LineUser } from "../flow";
import styles from "./select.module.css";

const PARTIES = [{ label: "1–4", value: "1-4" }, { label: "5–8", value: "5-8" }, { label: "9–12", value: "9-12" }, { label: "12+", value: "12+" }];
type Zone = { id: string; name: string; tablesLeft: number; available: boolean; closed?: boolean };
const MAP_ZONES = ["VIP", "Indoor", "Outdoor"];
type NightInfo = { zones: Zone[]; open: boolean; opensAt: string; closed?: boolean };
type Opening = { serviceDate: string; opensAt: string };
type Venue = { openNights: string[]; upcomingNights: Opening[]; timezone: string; nextDateAt: string; largePartyMode?: "staff_review" | "disabled";
  shop?: { name: string; entryPolicy: string } };

const openText = (iso: string, timeZone?: string) =>
  new Intl.DateTimeFormat("th-TH-u-ca-gregory", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23", timeZone }).format(new Date(iso));
const countdown = (seconds: number) => [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
  .map((number) => String(number).padStart(2, "0")).join(":");

export default function SelectForm({ slug }: { slug: string }) {
  const router = useRouter();
  const requested = serviceDate.safeParse(useSearchParams().get("date")).data;
  const { active, refresh: refreshActive } = useActiveBooking(slug);
  const [venue, setVenue] = useState<Venue>();
  const [date, setDate] = useState("");
  const [party, setParty] = useState(0);
  const [availability, setAvailability] = useState<NightInfo & { key: string }>();
  const [zoneId, setZoneId] = useState<string>();
  const [plan, setPlan] = useState<FloorPlan | null>(null);
  const [customer, setCustomer] = useState<(NonNullable<ReturnType<typeof loadCustomer>> & { scope: string })>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [canResume, setCanResume] = useState(false);
  const [scheduleVersion, setScheduleVersion] = useState(0);
  const [availabilityVersion, setAvailabilityVersion] = useState(0);
  const [now, setNow] = useState(Date.now);
  const attempt = useRef<BookingAttempt | null>(null);
  const userPickedDate = useRef(false);
  const dates = venue?.openNights ?? [];
  const upcoming = venue?.upcomingNights ?? [];
  const earliest = upcoming.reduce<Opening | undefined>((first, entry) =>
    !first || Date.parse(entry.opensAt) < Date.parse(first.opensAt) ? entry : first, undefined);
  const next = upcoming.find((entry) => entry.serviceDate === requested) ?? earliest;
  const nextAt = next ? Date.parse(next.opensAt) : 0;
  const boundaries = [earliest?.opensAt, venue?.nextDateAt].flatMap((value) => value ? [Date.parse(value)] : []);
  const refreshAt = boundaries.length ? Math.min(...boundaries) : undefined;
  const remaining = Math.max(0, Math.ceil((nextAt - now) / 1000));
  const partyBucket = PARTIES[party].value;
  const availabilityKey = `${date}:${partyBucket}:${availabilityVersion}`;
  const night = availability?.key === availabilityKey ? availability : undefined;
  const zones = night?.zones ?? [];
  const closed = night?.closed === true;
  const refreshSchedule = useCallback(() => {
    setScheduleVersion((v) => v + 1);
    setAvailabilityVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api<{ user: LineUser }>("/me", { signal: controller.signal }).then(({ user }) => {
      if (controller.signal.aborted) return;
      const scope = `${slug}:${user.userId}`;
      const saved = loadCustomer(scope);
      if (!saved) { router.replace(`/book/${slug}/details${requested ? `?date=${requested}` : ""}`); return; }
      setCustomer({ ...saved, scope });
      attempt.current = readAttempt(scope);
      setCanResume(attempt.current !== null);
    }).catch((e) => {
      if (!controller.signal.aborted && asFailure(e).status !== 401) setError(asFailure(e).message);
    });
    return () => controller.abort();
  }, [requested, router, slug]);

  useEffect(() => {
    const controller = new AbortController();
    api<Venue>("/venue", { signal: controller.signal }).then((v) => {
      if (controller.signal.aborted) return;
      setVenue(v);
      setDate((current) => {
        if (!userPickedDate.current && requested && v.openNights.includes(requested)) return requested;
        return v.openNights.includes(current) ? current : v.openNights[0] ?? "";
      });
      setNow(Date.now());
    }).catch((e) => { if (!controller.signal.aborted) setError(asFailure(e).message); });
    return () => controller.abort();
  }, [requested, scheduleVersion, slug]);

  useEffect(() => {
    if (!refreshAt) return;
    const timer = setTimeout(refreshSchedule, Math.max(0, refreshAt - Date.now()) + 150);
    const clock = nextAt ? setInterval(() => setNow(Date.now()), 1000) : undefined;
    return () => { clearTimeout(timer); clearInterval(clock); };
  }, [nextAt, refreshAt, refreshSchedule]);

  useEffect(() => {
    const visible = () => { if (document.visibilityState === "visible") refreshSchedule(); };
    window.addEventListener("focus", refreshSchedule);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", refreshSchedule);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refreshSchedule]);

  useEffect(() => {
    const controller = new AbortController();
    api<{ plan: FloorPlan | null }>("/floor-plan", { signal: controller.signal })
      .then((r) => { if (!controller.signal.aborted) setPlan(r.plan); }).catch(() => undefined);
    return () => controller.abort();
  }, [slug]);

  useEffect(() => {
    if (!date) return;
    const controller = new AbortController();
    api<NightInfo>(`/availability?date=${date}&partyBucket=${encodeURIComponent(partyBucket)}`, { signal: controller.signal })
      .then((r) => { if (!controller.signal.aborted) setAvailability({ ...r, key: availabilityKey }); })
      .catch((e) => { if (!controller.signal.aborted) setError(asFailure(e).message); });
    return () => controller.abort();
  }, [availabilityKey, date, partyBucket]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!customer || busy) return;
    const resumed = canResume ? attempt.current : null;
    if (!resumed && (active !== null || !zoneId || !night?.open || !zones.some((z) => z.id === zoneId && z.available))) return;
    const payload = resumed?.payload ?? JSON.stringify({ serviceDate: date, partyBucket, zoneId,
      contactName: customer.name, contactPhone: customer.phone });
    const same = attempt.current?.payload === payload ? attempt.current : null;
    setBusy(true); setError("");
    try {
      const current = same ?? { payload, id: crypto.randomUUID() };
      attempt.current = current;
      saveAttempt(customer.scope, current);
      const { booking } = await api<{ booking: { id: string } }>("/bookings", {
        method: "POST", body: JSON.parse(current.payload), idempotencyKey: current.id,
      });
      attempt.current = null;
      setCanResume(false);
      saveAttempt(customer.scope, null);
      router.push(`/book/${slug}/confirmed?b=${booking.id}`);
    } catch (e) {
      const failure = asFailure(e);
      setError(failure.code === "ZONE_FULL" ? "โซนนี้เต็มแล้ว กรุณาเลือกโซนอื่น"
        : failure.code === "NIGHT_NOT_OPEN" ? "คืนนี้ยังไม่เปิดรับจอง"
        : failure.code === "ACTIVE_BOOKING_EXISTS" ? (failure.details?.requestId ? "คำขอจองเดิมกำลังดำเนินการ" : "คุณมีการจองที่ยังใช้งานอยู่")
        : failure.message);
      if (failure.code === "ACTIVE_BOOKING_EXISTS") refreshActive();
      setBusy(false);
      if (failure.requestFinal || (failure.status >= 400 && failure.status < 500 && failure.status !== 401)) {
        attempt.current = null;
        saveAttempt(customer.scope, null);
      }
      setCanResume(attempt.current !== null);
      if (failure.code === "ZONE_FULL" || failure.code === "ZONE_CLOSED") {
        setZoneId(undefined);
        setAvailabilityVersion((v) => v + 1);
      }
      if (["NIGHT_NOT_OPEN", "BOOKING_CLOSED", "DATE_OUT_OF_RANGE", "CLOSED"].includes(failure.code)) {
        refreshSchedule();
      }
    }
  }

  const zoneButton = (name: string, className = "") => {
    const zone = zones.find((z) => z.name === name);
    const full = zone ? !zone.available : false;
    const selected = !!zone && zoneId === zone.id;
    return (
      <button type="button" key={name} aria-pressed={selected} disabled={!zone || full || !night?.open || closed || busy || active !== null}
        className={`${styles.zone} ${className} ${selected ? styles.zoneOn : ""} ${full ? styles.zoneFull : ""}`}
        onClick={() => zone && setZoneId(zone.id)}>
        {name}{full && <span className={styles.full}>{zone?.closed ? "ปิด" : "เต็ม"}</span>}
      </button>
    );
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.body}>
        <p className={styles.step}>ขั้นตอน 2 จาก 2</p>
        <h1 className={styles.title}>เลือกคืนและโซน</h1>
        <p className={styles.subtitle}>เลือกวันที่ จำนวนคน และพื้นที่ที่ต้องการ</p>
        {active && <ActiveBookingNotice slug={slug} booking={active} />}

        <label className={styles.label} htmlFor="date">คืนที่ต้องการ</label>
        <div className={styles.dateField}>
          <span>{date ? thaiDate(date) : venue ? "ยังไม่มีคืนเปิดจอง" : "กำลังโหลด…"}</span><span className={styles.chev} aria-hidden>⌄</span>
          {venue && <select id="date" className={styles.dateInput} value={date} disabled={busy || !dates.length}
            onChange={(e) => { userPickedDate.current = true; setDate(e.target.value); setZoneId(undefined); setError(""); }}>
            {!dates.length && <option value="">ยังไม่มีคืนเปิดจอง</option>}
            {dates.map((day) => <option key={day} value={day}>{thaiDate(day)}</option>)}
          </select>}
        </div>

        <span className={styles.label} id="party-label">จำนวนผู้เข้าร่วม</span>
        <div className={styles.party} role="group" aria-labelledby="party-label">
          {PARTIES.map((p, i) => venue?.largePartyMode === "disabled" && p.value === "12+" ? null : (
            <button type="button" key={p.value} aria-pressed={party === i}
              className={`${styles.pill} ${party === i ? styles.pillOn : ""}`} disabled={busy}
              onClick={() => { if (party !== i) { setParty(i); setZoneId(undefined); setError(""); } }}>{p.label}</button>
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
                  disabled: !z.available || !night?.open || closed || busy || active !== null,
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
        {closed && <p role="status" className={styles.error}>ร้านปิด · {"คืนนี้ปิดรับจอง"}</p>}
        {next && remaining > 0 && <div className={styles.caption}>
          <p>{thaiDate(next.serviceDate)} · เปิดจอง {openText(next.opensAt, venue?.timezone)} น.</p>
          <p role="timer" aria-label="เวลานับถอยหลังเปิดจอง">{countdown(remaining)}</p>
        </div>}
        {upcoming.length > 1 && <details className={styles.caption}>
          <summary>เวลาเปิดจองคืนอื่น</summary>
          <ul>{upcoming.filter((entry) => entry !== next).map((entry) =>
            <li key={entry.serviceDate}>{thaiDate(entry.serviceDate)} · เปิดจอง {openText(entry.opensAt, venue?.timezone)} น.</li>)}</ul>
        </details>}
        {requested && venue && !dates.includes(requested) && !upcoming.some((entry) => entry.serviceDate === requested)
          && <p className={styles.caption}>คืนที่ลิงก์ระบุยังไม่อยู่ในช่วงเปิดจอง: {thaiDate(requested)}</p>}
        <p className={styles.hint}>แตะพื้นที่บนผังเพื่อเลือกโซน</p>
        {venue?.shop?.entryPolicy && <p className={styles.caption} style={{ marginTop: 16, fontSize: 12 }}>นโยบายการเข้าร้าน: {venue.shop.entryPolicy}</p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </div>
      <div className={styles.footer}>
        <button type="submit" className={styles.cta} disabled={busy || !customer || (!canResume && (active !== null || !zoneId || !night?.open || closed))}>
          {busy ? "กำลังจอง…" : canResume ? "ตรวจผลคำขอก่อนหน้า" : zoneId ? "ยืนยันการจอง" : "เลือกโซนเพื่อดำเนินการต่อ"}
        </button>
      </div>
    </form>
  );
}
