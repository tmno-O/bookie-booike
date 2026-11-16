"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { customerApi } from "@/client/customer-api";
import { apiRequest, realApiMode } from "@/client/transport";
import styles from "./announcement-banner.module.css";

type Announcement = { id: string; title: string; serviceDate: string; opensAt: string; timezone: string };
type Data = { announcements: Announcement[] };
const serviceMonth = new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
  month: "short", year: "numeric", timeZone: "UTC",
});

export function AnnouncementBanner({ slug }: { slug: string }) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  useEffect(() => {
    const load = () => {
      const request = realApiMode
        ? customerApi<Data>("/announcements")
        : apiRequest<Data>("/api/mock/announcements");
      return request.then((data) => setAnnouncements(data.announcements)).catch(() => undefined);
    };
    void load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, []);

  if (announcements.length === 0) return null;
  return (
    <aside aria-label="ข่าวรอบจองใหม่">
      <ul className={styles.list} aria-live="polite">
        {announcements.map(({ id, title, serviceDate, opensAt, timezone }) => {
          const date = new Date(serviceDate);
          const opening = new Intl.DateTimeFormat("th-TH-u-ca-gregory", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });
          return (
            <li className={styles.ticket} key={id}>
              <div className={styles.content}>
                <p className={styles.label}>รอบจองพิเศษ</p>
                <p className={styles.title}><Link href={`/book/${slug}/select?date=${encodeURIComponent(serviceDate)}`}>{title}</Link></p>
                <p className={styles.opens}>เปิดจอง <time dateTime={opensAt}>{opening.format(new Date(opensAt))} น.</time></p>
              </div>
              <div className={styles.stub}>
                <span>คืนบริการ</span>
                <time dateTime={serviceDate}>
                  <span className={styles.day}>{date.getUTCDate()}</span>
                  <span>{serviceMonth.format(date)}</span>
                </time>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
