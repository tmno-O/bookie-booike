import { db } from "@/lib/db";

export async function bookingSchedule(venueId: string) {
  const [window] = await db()<{
    today: string; maxAdvanceDays: number;
    openNights: string[]; upcomingNights: { serviceDate: string; opensAt: string }[];
    firstOpenAt: Date | null; nextOpenAt: Date | null;
  }[]>`
    select to_char(w.today, 'YYYY-MM-DD') as today, w.max_advance_days,
      coalesce(array_agg(to_char(n.service_date, 'YYYY-MM-DD') order by n.service_date)
        filter (where n.opens_at <= statement_timestamp()), '{}') as open_nights,
      coalesce(jsonb_agg(jsonb_build_object('serviceDate', to_char(n.service_date, 'YYYY-MM-DD'), 'opensAt', n.opens_at)
        order by n.service_date) filter (where n.opens_at > statement_timestamp()), '[]') as upcoming_nights,
      min(n.opens_at) filter (where n.opens_at <= statement_timestamp()) as first_open_at,
      min(n.opens_at) filter (where n.opens_at > statement_timestamp()) as next_open_at
    from booking_window(${venueId}) w
    left join lateral (
      select w.today + i as service_date, opens_at_for(${venueId}, w.today + i) as opens_at
      from generate_series(0, w.max_advance_days) i
      left join booking_releases r on r.venue_id = ${venueId} and r.service_date = w.today + i
      where service_night_open(${venueId}, w.today + i) and (r.closes_at is null or r.closes_at > statement_timestamp())
    ) n on true
    group by w.today, w.max_advance_days
  `;
  const { firstOpenAt, nextOpenAt, ...days } = window;
  return { ...days, opensAt: firstOpenAt ?? nextOpenAt, open: firstOpenAt !== null,
    secondsUntilOpen: !firstOpenAt && nextOpenAt ? Math.max(0, Math.ceil((+nextOpenAt - Date.now()) / 1000)) : 0 };
}
