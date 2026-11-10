"use client";

import { useState } from "react";
import styles from "./select.module.css";

const PARTIES = [
  { label: "1–4", size: 2 },
  { label: "5–8", size: 6 },
  { label: "9–12", size: 10 },
  { label: "12+", size: 13 },
];

const thaiDate = (value: string) =>
  new Intl.DateTimeFormat("th-TH-u-ca-gregory", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));

// Step 4 of 4 — pick night, party size and zone (Figma "04 · เลือกคืน จำนวนคน และโซน", node 169:388)
export default function SelectForm({ slug, today }: { slug: string; today: string }) {
  const [date, setDate] = useState(today);
  const [party, setParty] = useState(0);
  const [zone, setZone] = useState<string>();
  const zoneButton = (name: string, className = "") => (
    <button type="button" key={name} aria-pressed={zone === name}
      className={`${styles.zone} ${className} ${zone === name ? styles.zoneOn : ""}`} onClick={() => setZone(name)}>{name}</button>
  );
  return (
    <form className={styles.form} action={`/book/${slug}`}>
      <div className={styles.body}>
        <p className={styles.step}>ขั้นตอน 4 จาก 4</p>
        <h1 className={styles.title}>เลือกคืนและโซน</h1>
        <p className={styles.subtitle}>เลือกวันที่ จำนวนคน และพื้นที่ที่ต้องการ</p>

        <label className={styles.label} htmlFor="date">คืนที่ต้องการ</label>
        <div className={styles.dateField}>
          <span>{thaiDate(date)}</span><span className={styles.chev} aria-hidden>⌄</span>
          <input id="date" name="date" type="date" className={styles.dateInput} value={date} min={today}
            onChange={(e) => e.target.value && setDate(e.target.value)} />
        </div>

        <span className={styles.label} id="party-label">จำนวนผู้เข้าร่วม</span>
        <div className={styles.party} role="group" aria-labelledby="party-label">
          {PARTIES.map((p, i) => (
            <button type="button" key={p.label} aria-pressed={party === i}
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
        <p className={styles.hint}>แตะพื้นที่บนผังเพื่อเลือกโซน</p>
        <p className={styles.caption}>ผังร้านตัวอย่าง</p>
        <input type="hidden" name="partySize" value={PARTIES[party].size} />
        <input type="hidden" name="zone" value={zone ?? ""} />
      </div>
      <div className={styles.footer}>
        <button type="submit" className={styles.cta} disabled={!zone}>{zone ? "ดำเนินการต่อ" : "เลือกโซนเพื่อดำเนินการต่อ"}</button>
      </div>
    </form>
  );
}
