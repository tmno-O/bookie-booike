# LINE notification audit

| Event | Source and delivery |
| --- | --- |
| Request awaiting allocation | The booking decision queues `received` for FCFS LINE customers. The worker skips it if the shop already decided the booking. |
| Automatic confirmation or staff allocation | The booking or allocation transaction queues `confirmed`. An allocation confirms the same booking. |
| Customer or staff cancellation | Cancelling queues `cancelled` and releases any active allocation. |
| Special closure with cancellation | Each cancelled booking gets a `cancelled` message with the closure reason. Choosing to keep bookings leaves them in place. |
| Rejected queued request | The decision queues `rejected` with a customer-facing reason, including the one-booking rule. Requests declined before admission show the API error in the app. |
| Booking reminder | Uses the owner's configured lead time. A cancelled booking or an obsolete reminder is skipped. |
| Release announcement and special-day reminder | Multicast targets eligible past bookers using the published release and the owner's reminder setting. Opt-outs and removed releases are skipped. |

Previously, booking delivery held a PostgreSQL row lock during the LINE call and a request awaiting manual allocation produced no notification. A short transaction now takes a lease before network I/O. A later worker can recover an expired lease and reuse the same LINE retry ID. Only the current lease holder can update the result. The app uses Thai date labels and renders times in the venue's timezone. Booking messages link to My Bookings. Announcements link to the service date on the select page. LIFF restores the destination after `liff.init()`.

The worker retries network failures, HTTP 429 and 5xx up to five attempts, with backoff. LINE can accept the retry ID without delivering to a customer who has blocked the account. Bookie records LINE acceptance, not a read receipt. An in-flight push cannot be recalled after cancellation or opt-out, and cancellation is a separate event. Missing credentials or a missing recipient mark the job `skipped`. Unknown production cron state is separate from LINE login being connected. [LINE retry API](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/) · [LIFF redirects](https://developers.line.biz/en/docs/liff/opening-liff-app/)

Before the production rollout, verify the `bookie-notifications` job with the read-only query in [DEPLOY.md](DEPLOY.md). Apply pending migrations before deploying code that reads the lease columns. Check the first authenticated invocation and `/api/health`, then verify a booking and a cancellation with an authorized LINE test account. `pending` counts jobs released for delivery, including retries and jobs on lease. `oldestPendingAgeSeconds` measures age from creation or the scheduled due time. `dead` counts jobs that need investigation. The endpoint exposes aggregate counts only.

Use one production scheduler. When minute-by-minute delivery is needed on Vercel Hobby, schedule `POST /api/internal/notifications/drain` through Supabase Cron. A Vercel plan with minute scheduling can use `GET` at the same endpoint. Both methods require `CRON_SECRET`. [Vercel Cron limits](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing)
