"use client";

import { useEffect, useState } from "react";
import { customerApi } from "@/client/customer-api";
import { apiRequest, realApiMode } from "@/client/transport";
import { deadlineText } from "./cancel-booking";
import styles from "./announcement-banner.module.css";

type Announcement = { id: string; title: string; serviceDate: string; opensAt: string };
type Data = { announcements: Announcement[] };
const serviceMonth = new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
  month: "short", year: "numeric", timeZone: "UTC",
});

export function AnnouncementBanner() {
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
        {announcements.map(({ id, title, serviceDate, opensAt }) => {
          const date = new Date(serviceDate);
          return (
            <li className={styles.ticket} key={id}>
              <div className={styles.content}>
                <p className={styles.label}>รอบจองพิเศษ</p>
                <p className={styles.title}>{title}</p>
                <p className={styles.opens}>เปิดจอง <time dateTime={opensAt}>{deadlineText(opensAt)} น.</time></p>
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
