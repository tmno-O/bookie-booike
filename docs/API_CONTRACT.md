# Bookie API

JSON ใช้ camelCase. ส่ง `Content-Type: application/json` เมื่อมี body. ข้อผิดพลาดคืน `{"error":{"code":"NOT_FOUND","message":"Booking not found"}}`. ดู [Zod contracts](../src/contracts/) และ [fixtures](fixtures/).

## ลูกค้า

| Method และ path | สัญญา |
| --- | --- |
| `GET /api/venues/by-slug/{slug}` | ข้อมูลร้าน, `liffId`, `opensAt`, `open`, `secondsUntilOpen`, `today`, `maxAdvanceDays` และ `shop` ที่มีชื่อ เบอร์ ที่อยู่ และนโยบายเข้าร้าน |
| `GET /api/venues/{venueId}/availability?date=YYYY-MM-DD&partyBucket=1-4` | `nightOpen`, `opensAt`, `zones[]` ที่มี `id,name,tablesLeft,available,closed` และ `tables[]` สำหรับ client เลือกโต๊ะ. `partyBucket` ใช้คำนวณความพร้อมของโซน |
| `GET /api/venues/{venueId}/floor-plan` | คืน `{plan}` เป็นผังที่ร้านเผยแพร่แล้วเท่านั้น (`null` เมื่อยังไม่เคยเผยแพร่ ให้ใช้ผังมาตรฐานของแอป). `plan` คือ `{zones:[{zoneId,points[{x,y}]}], markers:[{id,kind:entrance\|stage,label,x,y,width,height}]}` บนผ้าใบ 600×420 |
| `GET /api/venues/{venueId}/releases` | ช่วงเปิดรับที่ตั้งไว้รายคืน |
| `POST /api/session/line` | รับ `{venueSlug,idToken}` และตั้ง cookie `bookie_session` สำหรับร้าน. โหมดทดสอบรับ `mock:<id>:<name>` |
| `GET /api/me`, `POST /api/session/logout` | อ่าน `{user:{userId,displayName}}` หรือลบ session |
| `POST /api/venues/{venueId}/queue-tickets` | รับ `{name,phone}`. คืน `201` สำหรับ ticket ใหม่ หรือ `200` สำหรับ ticket เดิมที่ยังใช้งานได้. ก่อนเปิดจองคืน `403 NOT_OPEN` |
| `GET /api/me/queue-tickets/{id}` | คืน `{requestId,status,position,ready,bookingRequestId,bookingId}` เฉพาะเจ้าของ ticket. สถานะ `waiting`, `ready`, `used`, `expired` |
| `POST /api/booking-requests` | รับ `{venueId,ticketId,serviceDate,zoneId,partyBucket}` และ `Idempotency-Key`. คืน `202 {requestId}` เมื่อคำขอเข้าคิว (`QUEUE_DRIVER=db` ค่าเริ่มต้น: บันทึกลงตารางแล้ว, `sqs`: broker รับแล้ว) |
| `GET /api/me/booking-requests/{requestId}` | คืน `{requestId,status,resultCode,bookingId}`. สถานะ `pending_publish` (เฉพาะ `sqs`), `queued`, `confirmed`, `rejected` |
| `GET /api/me/bookings`, `GET /api/me/bookings/{bookingId}` | คืนรายการแบบ `{bookings,nextOffset}` หรือ booking เดี่ยว. รองรับ `date`, `limit` 1–100 (ค่าเริ่มต้น 50), `offset` |
| `POST /api/me/bookings/{bookingId}/cancel` | ยกเลิกตาม cutoff ของร้าน. การจองที่เช็กอินแล้วคืน `409 ALREADY_CHECKED_IN` |

- ตำแหน่งคิวเริ่มจาก 1 ตามลำดับรับ ticket. ค่าเริ่มต้นเรียกทีละ 1 คน มีเวลาเลือก 120 วินาทีหลังถึงคิว. Ticket ที่ใช้หรือหมดอายุแสดงตำแหน่ง 0.
- `partyBucket` แปลง `1-4` เป็น 4, `5-8` เป็น 8, `9-12` เป็น 12 และ `12+` เป็น 15. กลุ่ม 15 คนต้องเลือกโซนที่มีโต๊ะจุอย่างน้อย 15 คน.
- การรับคำขอต้องใช้ ticket สถานะ `ready` ของลูกค้าในร้านนั้น. ส่งก่อนเปิดคืนบริการได้ `409 NIGHT_NOT_OPEN`. คิวที่หมดอายุหรือใช้แล้วได้ `409 TICKET_NOT_READY`. ปิดโซนได้ `409 ZONE_CLOSED`.
- Worker โหมด `auto` เลือกโต๊ะว่างขนาดเล็กสุดที่รองรับกลุ่มในโซน. โต๊ะไม่พอได้ `rejected/ZONE_FULL`. โหมด `manual` สร้าง booking สถานะ `pending_allocation` และเริ่มถือโต๊ะเมื่อร้านจัดสรรสำเร็จ. ค่า `confirmed` ใน **booking request** หมายถึงสร้าง booking แล้ว ให้ดูสถานะการจัดสรรจาก **booking**.
- Booking คืน `reference` รูปแบบ `BL-YYYY-NNNN` (เลขรันอาจยาวเกิน 4 หลัก), `name`, `phone`, `zoneName`, `party`, `source`, `status` และ `checkedInAt`. สถานะ booking คือ `pending_allocation`, `confirmed`, `checked_in`, `cancelled`. รายการเก่าที่บันทึกเพียงเลขท้ายเบอร์โทรคืน `phone: ""`.
- โหมด `sqs` อาจได้ `503 QUEUE_UNAVAILABLE` ให้ส่ง payload เดิมด้วย key เดิม. โหมด `db` ไม่มีขั้น publish จึงไม่มี error นี้. Key เดิมกับ payload ต่างได้ `422 IDEMPOTENCY_CONFLICT`.
- API เลือกโต๊ะเดิมยังรองรับ `{venueId,serviceDate,partySize,tableId}` สำหรับ `customer_picks` หรือ `zoneId` สำหรับ `auto_assign`. ส่ง `serviceAt` แบบ ISO พร้อม offset และ `contactPhone` ได้. กรณีแย่งโต๊ะใน flow นี้ใช้ `TABLE_UNAVAILABLE`.

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
| `POST /booking-requests`, `GET /booking-requests/{requestId}` | POST รับ `{name,phone,serviceDate,party,zoneId}` กับ `Idempotency-Key`. ใช้ FIFO และโหมดจัดสรรของร้าน ข้ามคิวลูกค้าและเวลาเปิดจอง. อัปเดต contact ฝั่งร้านตามเบอร์เต็มและบันทึก `source=staff_assisted`. API เดิมยังรับ `customerId` กับ payload เลือกโต๊ะ |
| `GET /queue?date=&status=` | คำขอที่สร้าง booking แล้ว เรียง `queueNo` ตามคืนบริการ พร้อม `requestedAt`. สถานะ `pending`, `allocated` หรือ filter `all` |
| `GET /queue/{bookingId}`, `POST /queue/{bookingId}/allocate` | GET คืน `{request,phone,zones}`. POST รับ `{zoneId?}` เพื่อยืนยันในโซนเดิมหรือย้ายโซน. ได้ `ZONE_FULL` เมื่อโต๊ะไม่พอ และ `ALREADY_ALLOCATED` เมื่อจัดสรรไปแล้ว |
| `GET/POST /zones`, `GET/PATCH/DELETE /zones/{zoneId}` | GET รองรับ `date` สำหรับจำนวนที่จอง. POST และ PATCH รับ `seats` สำหรับโซนที่จัดการโต๊ะอัตโนมัติ 12 ที่นั่งต่อโต๊ะ จำนวน `ceil(seats/12)`. คงโต๊ะที่มีจองล่วงหน้า. ชื่อซ้ำได้ `ZONE_NAME_TAKEN` และลดต่ำกว่าที่จองได้ `CAPACITY_BELOW_BOOKED`. DELETE ปิดรับจอง. Payload เดิมที่ใช้ `capacity` ยังรองรับ |
| `GET/PUT /floor-plan`, `POST /floor-plan/publish` | GET (ทุก role) คืน `{plan,publishedAt,hasUnpublished}` ของฉบับร่าง. PUT (owner) บันทึกฉบับร่างหลังตรวจ: โซนเป็นรูปหลายเหลี่ยมไม่ตัดกันเอง ไม่ซ้อนกัน อยู่ในผ้าใบ ขั้นต่ำประมาณ 20×20 และทุก `zoneId` ต้องเป็นโซนของร้าน (ไม่เช่นนั้น `UNKNOWN_ZONE`). POST publish (owner) คัดลอกฉบับร่างเป็นฉบับเผยแพร่ ได้ `NO_FLOOR_PLAN` เมื่อยังไม่มีฉบับร่าง. ลูกค้าเห็นเฉพาะฉบับที่เผยแพร่แล้ว |
| `GET/POST /tables`, `GET/PATCH/DELETE /tables/{tableId}` | จัดการโต๊ะแบบกำหนดเอง. โซนที่ sync จาก `seats` จัดการโต๊ะผ่านความจุโซน |
| `GET /hours`, `PUT /hours/standard`, `POST /hours/special`, `DELETE /hours/special/{id}` | เจ้าของเท่านั้น. มาตรฐานรับ `{daysBefore,time}` (0–365 วัน, HH:mm). วันพิเศษรับ `{serviceDate,opensOn,time}` และใช้วันที่บริการเป็น `id`. วันซ้ำได้ `SPECIAL_DAY_EXISTS` |
| `GET/PUT /settings` | เจ้าของอ่านและบันทึก `{name,phone,address,entryPolicy}` ใน `profile`. PUT รับ object ของข้อมูลร้านโดยตรง |
| `PATCH /settings` | เจ้าของกำหนด `allocationMode: "auto" \| "manual"`, `tableSelectionMode` และ `cancelCutoffMinutes` |
| `GET /team` | คืน `{members,invites,canEdit}`. เจ้าของเห็นคำเชิญที่บันทึกไว้ |
| `POST /team/invites`, `DELETE /team/invites/{id}` | เจ้าของบันทึกหรือยกเลิกคำเชิญ `{email,role:"staff"}`. อีเมลซ้ำได้ `INVITE_EXISTS` และสมาชิกเดิมได้ `ALREADY_MEMBER` |
| `GET/PATCH /`, `GET/PATCH /rules`, `GET/PUT /releases` | อ่านข้อมูลร้าน กฎบริการ และเวลาเปิดรับรายคืน. การแก้ไขต้องเป็นเจ้าของ. กฎระดับโต๊ะมาก่อนโซนและร้าน ค่าที่เป็น null สืบทอดจาก scope ถัดไป |
| `GET/PATCH /line-integration`, `GET /booking-link` | ค่า LINE integration และลิงก์ LIFF กับ QR SVG. API ส่งเพียงสถานะว่าตั้งค่า secret แล้ว |
| `GET /customers?q=` | ค้น contact ภายในร้านจากชื่อ เลขท้ายเบอร์ หรือเบอร์เต็มที่ร้านบันทึก |

Route เวลาเปิดจอง, โปรไฟล์ร้าน และการจัดการคำเชิญคืน `403 FORBIDDEN` เมื่อ role เป็น staff. เวลามาตรฐานกับวันพิเศษตีความตาม `Asia/Bangkok`. วันพิเศษมีผลเหนือค่ามาตรฐานต่อคืนบริการ.
