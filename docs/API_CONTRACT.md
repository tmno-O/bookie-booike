# Bookie API

JSON ใช้ camelCase. ส่ง `Content-Type: application/json` เมื่อมี body. ข้อผิดพลาดคืน `{"error":{"code":"NOT_FOUND","message":"Booking not found"}}`. ดู [Zod contracts](../src/contracts/) และ [fixtures](fixtures/).

## ลูกค้า

| Method และ path | สัญญา |
| --- | --- |
| `GET /api/venues/by-slug/{slug}` | ข้อมูลร้าน, `liffId`, `opensAt`, `open`, `secondsUntilOpen`, `today`, `maxAdvanceDays`, `openNights`, `upcomingNights: [{serviceDate,opensAt}]` และ `shop` ที่มีชื่อ เบอร์ ที่อยู่ และนโยบายเข้าร้าน |
| `GET /api/venues/{venueId}/availability?date=YYYY-MM-DD&partyBucket=1-4` | `nightOpen`, `opensAt`, `zones[]` ที่มี `id,name,tablesLeft,available,closed` และ `tables[]` สำหรับ client เลือกโต๊ะ. `partyBucket` ใช้คำนวณความพร้อมของโซน |
| `GET /api/venues/{venueId}/floor-plan` | คืน `{plan}` เป็นผังที่ร้านเผยแพร่แล้วเท่านั้น (`null` เมื่อยังไม่เคยเผยแพร่ ให้ใช้ผังมาตรฐานของแอป). `plan` คือ `{zones:[{zoneId,points[{x,y}]}], markers:[{id,kind:entrance\|stage,label,x,y,width,height}]}` บนผ้าใบ 600×420 |
| `GET /api/venues/{venueId}/releases` | ช่วงเปิดรับที่ตั้งไว้รายคืน |
| `POST /api/session/line` | รับ `{venueSlug,idToken}` และตั้ง cookie `bookie_session` สำหรับร้าน. โหมดทดสอบรับ `mock:<id>:<name>` |
| `GET /api/me`, `POST /api/session/logout` | อ่าน `{user:{userId,displayName}}` หรือลบ session |
| `POST /api/booking-requests` | รับ `{venueId,zoneId,serviceDate,partyBucket,contactName,contactPhone}` พร้อม `Idempotency-Key`. คืน `202 {requestId}` เมื่อรับคำขอแล้ว (`db`: commit ลงฐานข้อมูล, `sqs`: broker รับแล้ว) |
| `GET /api/me/booking-requests/{requestId}` | คืน `{requestId,status,resultCode,bookingId}`. สถานะ `pending_publish` (เฉพาะ `sqs`), `queued`, `confirmed`, `rejected` |
| `GET /api/me/bookings`, `GET /api/me/bookings/{bookingId}` | คืนรายการแบบ `{bookings,nextOffset}` หรือ booking เดี่ยว. รองรับ `date`, `limit` 1–100 (ค่าเริ่มต้น 50), `offset`. `?active=1` คืนการจอง LINE ที่ยังใช้งานอยู่หนึ่งรายการหรือรายการว่าง |
| `POST /api/me/bookings/{bookingId}/cancel` | ยกเลิกตาม cutoff ของร้าน. การจองที่เช็กอินแล้วคืน `409 ALREADY_CHECKED_IN` |

- `partyBucket` แปลง `1-4` เป็น 4, `5-8` เป็น 8, `9-12` เป็น 12 และ `12+` เป็น 15. การรับ `12+` เป็นค่าตั้งของร้าน (`largePartyMode`): `staff_review` (ค่าเริ่มต้น) รับคำขอเป็น `pending_allocation` เมื่อโต๊ะว่างรวมกันในโซนนั่งพอ แล้วพนักงานยืนยันและระบบจองหลายโต๊ะในโซนเดียวกันให้; `disabled` ปฏิเสธด้วย `409 LARGE_PARTY_DISABLED`. ข้อมูลร้านสาธารณะมี `largePartyMode`.
- ส่งได้หลัง LINE login และเมื่อคืนนั้นเปิดรับ. ก่อนเปิดได้ `409 NIGHT_NOT_OPEN`, นอกช่วงจองได้ `422 DATE_OUT_OF_RANGE`, ร้านปิดได้ `409 CLOSED` และโซนปิดได้ `409 ZONE_CLOSED`. Rate limit นับตามลูกค้าต่อร้าน.
- ลูกค้าจองผ่าน LINE ได้หนึ่งรายการต่อร้าน รวมคำขอที่กำลังตัดสิน. รายการ `pending_allocation`, `confirmed` และ `checked_in` ตั้งแต่วันปัจจุบันตามเวลาร้านนับโควตา. ยกเลิกแล้วจองใหม่ได้ทันที. `409 ACTIVE_BOOKING_EXISTS` มี `error.details: {serviceDate, bookingId}` หรือ `{serviceDate, requestId}`. รายการที่ร้านจองแทนไม่นับโควตา.
- Worker โหมด `auto` เลือกโต๊ะว่างขนาดเล็กสุดที่รองรับกลุ่มในโซน. โต๊ะไม่พอได้ `rejected/ZONE_FULL`. โหมด `manual` สร้าง booking สถานะ `pending_allocation` และเริ่มถือโต๊ะเมื่อร้านจัดสรรสำเร็จ. ค่า `confirmed` ใน **booking request** หมายถึงสร้าง booking แล้ว ให้ดูสถานะการจัดสรรจาก **booking**.
- Booking คืน `reference` รูปแบบ `BL-YYYY-NNNN` (เลขรันอาจยาวเกิน 4 หลัก), `name`, `phone`, `zoneName`, `party`, `source`, `status` และ `checkedInAt`. สถานะ booking คือ `pending_allocation`, `confirmed`, `checked_in`, `cancelled`. รายการเก่าที่บันทึกเพียงเลขท้ายเบอร์โทรคืน `phone: ""`.
- โหมด `sqs` อาจได้ `503 QUEUE_UNAVAILABLE` ให้ส่ง payload เดิมด้วย key เดิม. โหมด `db` ไม่มีขั้น publish จึงไม่มี error นี้. Key เดิมกับ payload ต่างได้ `422 IDEMPOTENCY_CONFLICT`.

## ระบบ

| Method และ path | สัญญา |
| --- | --- |
| `GET /api/health` | คืน `{ok,checks:{database,queue}}` และ `503` เมื่อมีส่วนใดล่ม. โหมด `db` ไม่เช็ค SQS เพราะคิวอยู่ในฐานข้อมูล |

## พนักงาน

`POST /api/staff/session` รับ `{email,password,venueSlug?}` ผ่าน Supabase Auth แล้วตั้ง cookie `bookie_staff_session` แบบ HttpOnly อายุ 8 ชั่วโมง. บัญชีหลายร้านต้องระบุ `venueSlug`. `GET /api/staff/me` คืน `{staff:{email,displayName,role},venue:{id,slug,name}}`. `POST /api/staff/session/logout` คืน 204 และเพิกถอน cookie session.

เส้นทางด้านล่างใช้ prefix `/api/staff/venues/{venueId}` และรับ staff cookie หรือ `Authorization: Bearer <Supabase access token>`. ข้ามร้านคืน 404. การแก้ไขด้วย cookie ต้องมาจาก origin เดียวกัน.

| Method และ path | สัญญา |
| --- | --- |
| `GET /dashboard?date=` | คืน `serviceDate,today,maxAdvanceDays,metrics,bookings,zones`. Metrics รวมจำนวนจอง แขก รอจัดสรรและเช็กอิน. ความจุที่ใช้รวม booking ที่ยืนยันและเช็กอินแล้ว |
| `GET /bookings?date=&status=&zone=&q=` | คืนรายการแบบมี pagination. ค้นชื่อ เบอร์เต็ม หรือเลขอ้างอิง. `status=pending` ใช้แทน `pending_allocation` ได้ |
| `GET/PATCH /bookings/{bookingId}` | GET คืน booking กับ `canCheckIn`. PATCH รับ `{"status":"cancelled"}` |
| `POST /bookings/{bookingId}/check-in` | เช็กอิน booking ที่ยืนยันแล้วครั้งเดียวในคืนบริการตามเวลา Bangkok. การเช็กอินซ้ำคืน `409 ALREADY_CHECKED_IN` และผิดคืนคืน `409 NOT_SERVICE_DATE` |
| `GET /availability?date=&partyBucket=` | คืน `{zones}` สำหรับ staff-assisted booking โดยใช้ความจุและกฎการให้บริการ |
| `POST /booking-requests`, `GET /booking-requests/{requestId}` | POST รับ `{name,phone,serviceDate,party,zoneId}` กับ `Idempotency-Key`. ใช้ FIFO และโหมดจัดสรรของร้าน ข้ามเวลาเปิดจอง. อัปเดต contact ฝั่งร้านตามเบอร์เต็มและบันทึก `source=staff_assisted`. API เดิมยังรับ `customerId` กับ payload เลือกโต๊ะ |
| `GET /queue?date=&status=` | คำขอที่สร้าง booking แล้ว เรียง `queueNo` ตามคืนบริการ พร้อม `requestedAt`. สถานะ `pending`, `allocated` หรือ filter `all` |
| `GET /queue/{bookingId}`, `POST /queue/{bookingId}/allocate` | GET คืน `{request,phone,zones}`. POST รับ `{zoneId?}` เพื่อยืนยันในโซนเดิมหรือย้ายโซน. ได้ `ZONE_FULL` เมื่อโต๊ะไม่พอ และ `ALREADY_ALLOCATED` เมื่อจัดสรรไปแล้ว |
| `GET/POST /zones`, `GET/PATCH/DELETE /zones/{zoneId}` | GET รองรับ `date` สำหรับจำนวนที่จอง. POST และ PATCH รับ `seats` สำหรับโซนที่จัดการโต๊ะอัตโนมัติ 12 ที่นั่งต่อโต๊ะ จำนวน `ceil(seats/12)`. คงโต๊ะที่มีจองล่วงหน้า. ชื่อซ้ำได้ `ZONE_NAME_TAKEN` และลดต่ำกว่าที่จองได้ `CAPACITY_BELOW_BOOKED`. DELETE ปิดรับจอง. Payload เดิมที่ใช้ `capacity` ยังรองรับ |
| `GET/PUT /floor-plan`, `POST /floor-plan/publish` | GET (ทุก role) คืน `{plan,publishedAt,hasUnpublished}` ของฉบับร่าง. PUT (owner) บันทึกฉบับร่างหลังตรวจ: โซนเป็นรูปหลายเหลี่ยมไม่ตัดกันเอง ไม่ซ้อนกัน อยู่ในผ้าใบ ขั้นต่ำประมาณ 20×20 และทุก `zoneId` ต้องเป็นโซนของร้าน (ไม่เช่นนั้น `UNKNOWN_ZONE`). POST publish (owner) คัดลอกฉบับร่างเป็นฉบับเผยแพร่ ได้ `NO_FLOOR_PLAN` เมื่อยังไม่มีฉบับร่าง. ลูกค้าเห็นเฉพาะฉบับที่เผยแพร่แล้ว |
| `GET/POST /tables`, `GET/PATCH/DELETE /tables/{tableId}` | จัดการโต๊ะแบบกำหนดเอง. โซนที่ sync จาก `seats` จัดการโต๊ะผ่านความจุโซน |
| `PUT /hours/service` | เจ้าของเท่านั้น. รับ `{openWeekdays,serviceStart,serviceEnd}` (HH:mm, เวลาปิดน้อยกว่าหรือเท่ากับเวลาเปิดแปลว่าปิดหลังเที่ยงคืน) ใช้เวลาเดียวกันทุกวันที่เปิด. `GET /hours` คืน `service:{start,end}` ด้วย (ค่าเริ่มต้น 18:00–02:00) |
| `GET /hours`, `PUT /hours/standard`, `POST /hours/special`, `DELETE /hours/special/{id}` | เจ้าของเท่านั้น. มาตรฐานรับ `{daysBefore,time}` (0–365 วัน, HH:mm). วันพิเศษรับ `{serviceDate,opensOn,time}` และใช้วันที่บริการเป็น `id`. วันซ้ำได้ `SPECIAL_DAY_EXISTS` |
| `GET/PUT /settings` | เจ้าของอ่านและบันทึก `{name,phone,address,entryPolicy}` ใน `profile`. PUT รับ object ของข้อมูลร้านโดยตรง |
| `PATCH /settings` | เจ้าของกำหนด `allocationMode: "auto" \| "manual"`, `tableSelectionMode` และ `cancelCutoffMinutes` |
| `GET /team` | คืน `{members,invites,canEdit}`. เจ้าของเห็นคำเชิญที่บันทึกไว้ |
| `POST /team/invites`, `DELETE /team/invites/{id}` | เจ้าของบันทึกหรือยกเลิกคำเชิญ `{email,role:"staff"}`. อีเมลซ้ำได้ `INVITE_EXISTS` และสมาชิกเดิมได้ `ALREADY_MEMBER` |
| `GET/PATCH /`, `GET/PATCH /rules`, `GET/PUT /releases` | อ่านข้อมูลร้าน กฎบริการ และเวลาเปิดรับรายคืน. การแก้ไขต้องเป็นเจ้าของ. กฎระดับโต๊ะมาก่อนโซนและร้าน ค่าที่เป็น null สืบทอดจาก scope ถัดไป |
| `GET/PATCH /line-integration`, `GET /booking-link` | ค่า LINE integration และลิงก์เว็บ `{slug,webUrl,webQrSvg}` กับลิงก์ LIFF `{url,qrSvg}` (เป็น `null` ถ้าไม่ได้ตั้ง LIFF). API ส่งเพียงสถานะว่าตั้งค่า secret แล้ว |

เจ้าของร้านเปลี่ยน `slug` ด้วย `PATCH /api/staff/venues/{venueId}` หรือ `PATCH .../settings` โดยส่ง `{slug}`. รหัสซ้ำคืน `409 SLUG_TAKEN`. ถ้าเปลี่ยนรหัสร้านที่เชื่อม LINE แล้ว ให้ตั้ง LIFF Endpoint URL เป็น `<webUrl>/login` และอัปเดต Rich Menu. ถ้าเป็นร้านเริ่มต้น ให้ตั้ง `DEFAULT_VENUE_SLUG` ให้ตรงก่อน deploy ครั้งถัดไป.
| `GET /customers?q=` | ค้น contact ภายในร้านจากชื่อ เลขท้ายเบอร์ หรือเบอร์เต็มที่ร้านบันทึก |

Route เวลาเปิดจอง, โปรไฟล์ร้าน และการจัดการคำเชิญคืน `403 FORBIDDEN` เมื่อ role เป็น staff. เวลามาตรฐานกับวันพิเศษตีความตาม `Asia/Bangkok`. วันพิเศษมีผลเหนือค่ามาตรฐานต่อคืนบริการ.
# วันเปิดร้านและวันปิดพิเศษ

Owner: `GET /api/staff/venues/{venueId}/hours` returns `openWeekdays` (Sunday=0) and `closures` with `serviceDate`, `reason`, `affectedBookings`. `PUT .../hours/closures` accepts `{openWeekdays: number[]}`; an empty array closes every weekday. `GET .../hours/closures?date=YYYY-MM-DD` previews affected bookings. `POST .../hours/closures` accepts `{serviceDate, reason, bookings?: "keep" | "cancel"}`. When the night has confirmed or pending bookings, `bookings` is required (`409 CLOSURE_HAS_BOOKINGS` otherwise): `keep` leaves them, `cancel` cancels them in the same transaction and queues a LINE cancellation that includes the reason. Checked-in bookings are never cancelled. The response adds `cancelledBookings`. `PUT .../hours/closures` returns `affectedBookings`, the upcoming bookings that now fall on a closed weekday. `DELETE .../hours/closures/{date}` reopens that night. Public venue adds `openWeekdays`, `closedDates`; `opensAt` is null when the bookable window contains no open nights. Closed nights reject requests with `CLOSED`, including requests already queued before closure.

## Cancellation policy

Owner `PATCH .../settings` accepts `customerCancelEnabled`, `cancelCutoffMinutes` (0–525600) and `largePartyMode` (`staff_review` | `disabled`). Booking views include `cancellableUntil` (null when disabled) and `canCancel`. Customer `POST /api/me/bookings/{id}/cancel` returns the updated booking. Conflicts: `CANCEL_DISABLED`, `CANCELLATION_CUTOFF_PASSED`, `ALREADY_CHECKED_IN` (409). Repeated cancellation is idempotent. Staff `PATCH .../bookings/{id}` with `{status: "cancelled"}` bypasses customer policy. Both pending allocations and confirmed bookings can be cancelled; active allocations are released atomically.

Owner `GET/PATCH .../settings` exposes `bookingReminderHours` and `specialReminderHours`. Each accepts an integer from 1 to 8760 or `null` to disable it. The default is 24 hours. Lead times apply to confirmed bookings and published special days, measured from their service start. Saving updates upcoming reminders that have yet to be attempted.

## Release announcements

Owner `POST .../hours/special` also accepts `title` (120 characters) and `announce` (default false). Announcement requires a nonempty title and an open service night. Creation records the release and announcement under the venue lock. The audience (one outbox row per customer with a prior booking, excluding opt-out) is then queued in batches of 1,000 outside that lock, so booking decisions are not blocked; an interrupted fan-out resumes on the next drain. Delivery uses LINE multicast with up to 500 recipients per request; the batch id is the LINE retry key, and the LINE call runs outside any database transaction. Retrying the same special day returns `409 SPECIAL_DAY_EXISTS` without duplicating recipients. Hours responses include recipient/sent/failed counts.

Session-scoped `GET /api/me/announcements` returns `{announcements: [{id,title,serviceDate,opensAt}], optedOut}`. Closed, deleted, replaced, or expired releases are hidden. `POST /api/me/announcements/opt-out` accepts `{optOut: boolean}`; opting out skips pending pushes. `POST /api/internal/notifications/drain` requires `Authorization: Bearer <CRON_SECRET>` and handles booking and announcement outboxes with bounded work, retries, and stale-job expiry. See DEPLOY.md for Supabase Cron configuration.

## Audit trail and receipts

Staff `GET /api/staff/venues/{venueId}/audit?date=YYYY-MM-DD&limit=50&offset=0&q=...` returns `{date,entries,nextOffset}`. Search accepts a reference substring or exactly four phone digits. Entries contain string-valued bigint `id`, `seq`, `ticketSeq`, `queueSeq`, timestamps, action/actor, result code, table/zone IDs, reference, masked phone, and full `rowHash`. Events sort by audit `seq` across the venue; request decisions retain `queue_seq` for comparison. Unused tickets have no service night and appear under their Bangkok issue date until linked to a request.

`GET .../audit/verify?from=&to=` verifies an optional inclusive audit-sequence range; omitted bounds verify the whole venue. Returns `valid`, `checked`, `firstBadSeq`, `firstBadId`, `lastSeq`, `headHash`. Range verification uses the preceding stored hash as its boundary. `checkpoints: {configured, checked, firstInvalidSeq, latestSeq}` reports signed checkpoints; `valid` is false when the chain or any checkpoint fails. A checkpoint fails when its Ed25519 signature does not verify or the row at its `seq` no longer has the signed hash. Owner `GET .../audit/checkpoint` returns the latest signed checkpoint with its signed `message` and `publicKeyPem` for offline storage. `POST /api/internal/audit/checkpoint` (Cron, `Bearer <CRON_SECRET>`) signs each venue head that moved; it returns 503 without `AUDIT_SIGNING_KEY`. `GET .../audit/export.csv?date=&q=` is owner-only and exports all matching rows with masked phone numbers and spreadsheet formula escaping. `GET .../bookings/{bookingId}/timeline` is tenant-scoped and returns booking-related entries.

Booking views include nullable `receipt: {reference,queueSeq,receivedAt,decidedAt,verifyCode}`. `verifyCode` is the first 16 hex characters of the immutable confirmation/allocation-pending audit row hash. It remains stable after cancellation. Staff compare the request sequence, receipt and reference with stored evidence. Historical tickets remain in the audit log. Hash-chain limitations and pre-migration timestamp limitations are documented in README.md. Mock audit responses explicitly mark `simulated: true`.

`GET /api/health` also includes `backlog: {pending,oldestAgeSeconds}` for queued/unpublished requests (null when DB check fails), without exposing venue/customer identifiers.
