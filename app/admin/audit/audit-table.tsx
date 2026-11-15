import type { AuditEntry } from "@/contracts/audit";
import styles from "../admin.module.css";

export const auditClock = (iso: string) => new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3,
  hourCycle: "h23", timeZone: "Asia/Bangkok",
}).format(new Date(iso));

export function AuditTable({ entries }: { entries: AuditEntry[] }) {
  return <div style={{ overflowX: "auto" }}><table className={styles.table}>
    <caption style={{ textAlign: "left", paddingBlock: 12 }}>เวลา Asia/Bangkok · ลำดับหลักฐานเรียงตาม seq</caption>
    <thead><tr><th>seq / เวลา</th><th>เหตุการณ์</th><th>อ้างอิง / เบอร์</th><th>ticket / queue_seq</th><th>รับ / ตัดสิน</th><th>ผล / โต๊ะ / โซน</th><th>รหัสตรวจสอบ</th></tr></thead>
    <tbody>{entries.map((e) => <tr key={e.id}>
      <td>{e.seq}<br /><time dateTime={e.createdAt}>{auditClock(e.createdAt)}</time></td>
      <td>{e.action}<br /><small>{e.actor}</small></td><td>{e.reference ?? "–"}<br />{e.phone || "–"}</td>
      <td>{e.ticketSeq ?? "–"}<br />{e.queueSeq ?? "–"}</td>
      <td>{e.receivedAt ? auditClock(e.receivedAt) : "–"}<br />{e.decidedAt ? auditClock(e.decidedAt) : "–"}</td>
      <td>{e.resultCode ?? "–"}<br /><small title={e.tableId ?? undefined}>{e.tableName ?? "–"}</small><br /><small title={e.zoneId ?? undefined}>{e.zoneName ?? "–"}</small></td>
      <td><code title={e.rowHash}>{e.rowHash.slice(0, 16)}</code></td>
    </tr>)}</tbody>
  </table>{entries.length === 0 && <p>ยังไม่มีหลักฐานสำหรับเงื่อนไขนี้</p>}</div>;
}
