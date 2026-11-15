import { db } from "@/lib/db";

export async function queueOpening(venueId: string) {
  const [window] = await db()<{
    today: string; maxAdvanceDays: number; opensAt: Date | null; secondsUntilOpen: number;
  }[]>`
    select to_char(today, 'YYYY-MM-DD') as today, max_advance_days, opens_at,
      greatest(0, ceil(extract(epoch from (opens_at - now()))))::int as seconds_until_open
    from queue_opening(${venueId})
  `;
  return { ...window, open: window.opensAt !== null && window.secondsUntilOpen === 0 };
}
