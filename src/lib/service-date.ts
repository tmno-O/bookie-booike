const bangkokCalendar = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bangkok", dateStyle: "short" });

export function bangkokDate(now = new Date()) {
  return bangkokCalendar.format(now);
}
