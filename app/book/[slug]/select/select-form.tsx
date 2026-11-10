"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { api, asFailure, thaiDate } from "../flow";
import styles from "./select.module.css";

const PARTIES = [{ label: "1–4", value: "1-4" }, { label: "5–8", value: "5-8" }, { label: "9–12", value: "9-12" }, { label: "12+", value: "12+" }];
type Zone = { id: string; name: string; tablesLeft: number; available: boolean; closed?: boolean };
const MAP_ZONES = ["VIP", "Indoor", "Outdoor"];
type NightInfo = { zones: Zone[]; open: boolean; opensAt: string };
const openText = (iso: string) =>
  new Intl.DateTimeFormat("th-TH-u-ca-gregory", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" }).format(new Date(iso));
type Venue = { today: string; maxAdvanceDays: number };

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
  const [night, setNight] = useState<{ open: boolean; opensAt: string }>({ open: true, opensAt: "" });
  const [zoneId, setZoneId] = useState<string>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Only customers whose queue turn has arrived may pick a night.
  useEffect(() => {
    if (!requestId) { router.replace(`/book/${slug}/waiting`); return; }
    let active = true;
    Promise.all([
      api<{ status: string }>(`/queue/${requestId}`),
      api<Venue>("/venue"),
    ]).then(([queue, v]) => {
      if (!active) return;
      if (queue.status === "waiting") router.replace(`/book/${slug}/queue?r=${requestId}`);
      else { setVenue(v); setDate(v.today); }
    }).catch((e) => {
      if (!active) return;
      if (asFailure(e).status === 404) router.replace(`/book/${slug}/waiting`);
      else setError(asFailure(e).message);
    });
    return () => { active = false; };
  }, [requestId, router, slug]);

  const loadZones = (day: string) => api<NightInfo>(`/availability?date=${day}`)
    .then((r) => { setZones(r.zones); setNight({ open: r.open, opensAt: r.opensAt }); return r.zones; });
  useEffect(() => {
    if (!date) return;
    let active = true;
    api<NightInfo>(`/availability?date=${date}`)
      .then((r) => { if (active) { setZones(r.zones); setNight({ open: r.open, opensAt: r.opensAt }); } }).catch((e) => active && setError(asFailure(e).message));
    return () => { active = false; };
  }, [date]);

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
      if (failure.code === "ZONE_FULL") { setZoneId(undefined); void loadZones(date); }
    }
  }

  const zoneButton = (name: string, className = "") => {
    const zone = zones.find((z) => z.name === name);
    const full = zone ? !zone.available : false;
    const selected = !!zone && zoneId === zone.id;
    return (
      <button type="button" key={name} aria-pressed={selected} disabled={!zone || full || !night.open}
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
          {venue && <input id="date" type="date" className={styles.dateInput} value={date}
            min={venue.today} max={addDays(venue.today, venue.maxAdvanceDays)}
            onChange={(e) => { if (e.target.value) { setDate(e.target.value); setZoneId(undefined); } }} />}
        </div>

        <span className={styles.label} id="party-label">จำนวนผู้เข้าร่วม</span>
        <div className={styles.party} role="group" aria-labelledby="party-label">
          {PARTIES.map((p, i) => (
            <button type="button" key={p.value} aria-pressed={party === i}
              className={`${styles.pill} ${party === i ? styles.pillOn : ""}`} onClick={() => setParty(i)}>{p.label}</button>
          ))}
        </div>

        <span className={styles.label} id="zone-label">โซนที่ต้องการ</span>
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
        {!night.open && night.opensAt && <p role="status" className={styles.error} style={{ color: "#b94e29" }}>คืนนี้ยังไม่เปิดรับจอง · เปิดรับจอง {openText(night.opensAt)} น.</p>}
        <p className={styles.hint}>แตะพื้นที่บนผังเพื่อเลือกโซน</p>
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </div>
      <div className={styles.footer}>
        <button type="submit" className={styles.cta} disabled={!zoneId || busy}>
          {busy ? "กำลังจอง…" : zoneId ? "ยืนยันการจอง" : "เลือกโซนเพื่อดำเนินการต่อ"}
        </button>
      </div>
    </form>
  );
}
