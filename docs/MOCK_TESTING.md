# Mock booking flow (local testing)

The six customer screens run against mock APIs under `/api/mock/*`, backed by a JSON file
(`.mock/db.json`, git-ignored, created on first use). No Docker, Supabase, SQS or LINE needed.
The mock APIs return 404 when `NODE_ENV=production` unless `MOCK_API=1`.

```bash
npm ci
npm run dev -- --port 3100
```

Open <http://localhost:3100/book/bookie-demo/login> in a phone-sized window. Every screen redirects to the login if you are not logged in.

## Mock LINE login

`/login` offers three fake LINE accounts (เจ๊ม่อน `Umock0001`, พี่แมว `Umock0002`, น้องบี `Umock0003`) or a new typed name.
It sends a mock ID token (`mock:<userId>:<displayName>`, same format as `LINE_VERIFY_MODE=mock`) to `POST /api/mock/line/login`,
which sets the `mock_customer` cookie. `GET /api/mock/me` returns the profile, `POST /api/mock/line/logout` clears the cookie.
Queue and booking APIs return `401 UNAUTHENTICATED` without a session. Logging in again as the same account brings back its bookings.

## Flow

0. **Login** (`/login`): choose a LINE account.
1. **Details** (`/details`): name + phone (`0` then 8–9 digits). Saved in the browser session only.
2. **Waiting** (`/waiting`): polls `GET /api/mock/venue`. "รับคิวจอง" is disabled until the venue opens, then calls `POST /api/mock/queue`.
3. **Queue** (`/queue?r=<requestId>`): polls `GET /api/mock/queue/{id}`. Starts at position 12 and drops one place every `queueStepSeconds` (default 2s); at position 1 the button unlocks.
4. **Select** (`/select?r=<requestId>`): `GET /api/mock/availability?date=`, then `POST /api/mock/bookings`.
5. **Confirmed** (`/confirmed?b=<bookingId>`): `GET /api/mock/bookings/{id}`.
6. **My bookings** (`/bookings`): `GET /api/mock/bookings`.

Each LINE account only sees its own queue entries and bookings.

## Admin dashboard

Open <http://localhost:3100/admin> (desktop width). It redirects to `/admin/login`, a mock staff sign-in with
`owner@bookie.test` (เจ้าของร้าน) and `staff@bookie.test` (พนักงาน) — no password. The session cookie is `mock_staff`,
separate from the customer LINE cookie, so you can be logged in as both in one browser.

`GET /api/mock/admin/dashboard?date=YYYY-MM-DD` (staff only) returns the night's totals, booking list and zone seat usage.
The page refreshes every 5 seconds, so customer bookings made in another window appear on their own.
Guest counts are estimated from the party bucket (1–4 → 4, 5–8 → 8, 9–12 → 12, 12+ → 15).
"รอจัดสรร" counts bookings awaiting zone allocation plus customers still waiting in the queue.
### Add booking (staff-assisted)

"+ เพิ่มการจอง" opens a dialog over the dashboard (`/admin/bookings/new`): fill in name, phone, night, party size and zone →
review → "สร้างการจองแล้ว". It calls `POST /api/mock/admin/bookings` (staff only), which creates a confirmed booking with channel
"จองโดยร้าน" (no queue). It uses the same table capacity as customer bookings, so a full zone shows "(เต็ม)" and the API returns
`409 ZONE_FULL`. Press Esc or "กลับ" on the first step to close it.

The other admin pages (bookings list, queue, zones, hours, settings, booking details) show a "coming soon" placeholder.

## Seed data

- Zones: VIP (2 tables), Indoor (4), Outdoor (4), per night.
- Tonight has 4 sample bookings (เจ๊ม่อน, คุณเมย์, คุณนัท, คุณแพรว) as in the admin design. VIP has 1 of 2 tables taken, so one more customer booking fills it.
- Bookable window: today through today + 6 days.

## Test helper

`POST /api/mock/reset` restores seed data. Optional body:

```json
{ "opensInSeconds": 30, "queueStepSeconds": 0.3 }
```

- `opensInSeconds`: venue opens this many seconds from now (shows the countdown on screen 2).
- `queueStepSeconds`: seconds per queue position (`0` = instantly ready).

## Automated tests

```bash
npm test
```
