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

### Booking details and check-in

"ดูรายละเอียด ›" on a dashboard row opens a details dialog (`/admin/bookings/<id>`): customer, phone, night, party/zone,
channel and reference, status. "เช็กอิน" calls `POST /api/mock/admin/bookings/{id}/check-in`, which sets the status to
"เช็กอินแล้ว" and shows "เช็กอินเรียบร้อย"; the dashboard totals update. Rules: a booking can be checked in once
(`409 ALREADY_CHECKED_IN`) and only on its own night (`409 NOT_SERVICE_DATE`, the button is disabled with a note).
Both confirmed and "รอจัดสรร" bookings can be checked in, as in the Figma design. `GET /api/mock/admin/bookings/{id}` is staff only.

### Booking queue

`/admin/queue` lists customer requests for a night in queue order (`#12`, send time, customer, party, zone, status) with
filters ทั้งหมด / รอจัดสรร / จัดสรรแล้ว; the page refreshes every 5 seconds. Customers who book through the LINE flow get the next
queue number (staff-created bookings skip the queue). "ดูรายละเอียด ›" opens `/admin/queue/<id>` with the request; "จัดสรรโซน"
(`POST /api/mock/admin/queue/{id}/allocate`) confirms it in the requested zone. If that zone is full (`409 ZONE_FULL`) a zone
picker appears so staff can allocate to another zone. A pending request ("รอจัดสรร") does **not** hold a table until it is allocated.
Seed data has three pending requests (#12 คุณเมย์ Indoor, #13 คุณบาส Outdoor, #14 คุณแนน VIP).

### Zones and capacity

`/admin/zones` lists zones with capacity (seats), seats booked tonight and status (เปิดรับจอง / ปิดรับจอง). "+ เพิ่มโซน" and
"แก้ไข ›" open dialogs (name, capacity in people, status); a green banner confirms the save. APIs (staff only):
`GET/POST /api/mock/admin/zones`, `PATCH /api/mock/admin/zones/{id}`.
Rules: names are unique (`409 ZONE_NAME_TAKEN`); one table seats 12 people, so capacity sets how many bookings a night can hold
(24 seats = 2 tables); capacity can't drop below what is already booked on an upcoming night (`409 CAPACITY_BELOW_BOOKED`);
renaming updates existing bookings; a closed zone keeps its bookings but rejects new customer, staff and allocated bookings
(`409 ZONE_CLOSED`) and shows "ปิด" to customers. Zones you add appear under the map on the customer select screen.

### Booking open times

`/admin/hours` shows the standard rule ("ทุกคืน · เปิดจองล่วงหน้า 1 วัน · เวลา 20:00 น.") and a list of special days.
"แก้ไขค่าเริ่มต้น" edits how many days before the night booking opens (0–7) and the time; "+ เพิ่มวันพิเศษ" adds a night with its
own opening date and time (`opensOn` can't be after the night; one special day per night; "ลบ" removes it). Only the owner
can edit (`403 FORBIDDEN` for `staff@bookie.test`, who sees the page read-only).
APIs: `GET /api/mock/admin/hours`, `PUT .../hours/standard`, `POST .../hours/special`, `DELETE .../hours/special/{id}`.

The schedule drives the customer side. Night D opens at the standard time N days before D (Bangkok time), or at the special
day's date and time. Customers can't book a night before it opens (`409 NIGHT_NOT_OPEN`; the select screen shows "คืนนี้ยังไม่เปิดรับจอง ·
เปิดรับจอง <time>" and disables the zones). The queue and the countdown on the waiting screen open when the first bookable night
opens. With the default (1 day before, 20:00) tonight is open and tomorrow opens at 20:00 today. Staff-created bookings ignore the schedule.
`opensInSeconds` on reset still holds the queue closed for testing the countdown.

### Shop settings and team

`/admin/settings` has the shop info (name, phone, address), the entry policy and a "ทีมและสิทธิ์" card. "บันทึกการเปลี่ยนแปลง"
saves with `PUT /api/mock/admin/settings` (owner only; `staff@bookie.test` sees read-only fields). The shop name shows in the admin
sidebar and top bar, and the entry policy is shown to customers on the select screen (`GET /api/mock/venue` returns `shop`).
"จัดการทีมและสิทธิ์ ›" opens the team dialog (roles, members, pending invitations). The owner can "เชิญพนักงาน" by email
(`POST /api/mock/admin/team/invites`; duplicate invites and existing members are rejected) and cancel a pending invitation
(`DELETE .../team/invites/{id}`). Invitations are only recorded, since the mock sends no email and invited people can't sign in.

### Booking list

`/admin/bookings` lists every booking for one night (default tonight) with a day stepper (‹ date ›, or tap the date for a picker),
status and zone filters, and a search over name, phone and booking reference. "การจอง N รายการ" shows the result count. The page
refreshes every 5 seconds. "ดูรายละเอียด ›" opens the same details / check-in dialog over the list and returns to the same night.
API: `GET /api/mock/admin/bookings?date=&status=&zone=&q=` (staff only). "+ เพิ่มการจอง" opens the add-booking dialog.

Every admin page from the Figma Admin file is now built (dashboard, booking list, queue, zones, open times, settings and team).

## Seed data

- Zones: VIP 24 seats (2 tables), Indoor 48 (4), Outdoor 60 (5), per night.
- Tonight has 6 sample bookings (เจ๊ม่อน, คุณเมย์, คุณนัท, คุณแพรว, คุณบาส, คุณแนน) as in the admin designs; 3 are pending allocation. VIP has 1 of 2 tables taken, so one more customer booking fills it.
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
