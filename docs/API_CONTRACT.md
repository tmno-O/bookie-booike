# Bookie API

JSON ใช้ camelCase และส่ง `Content-Type: application/json` สำหรับ body. คำตอบ error ใช้ `{"error":{"code":"NOT_FOUND","message":"Booking not found"}}`. Schema กับ fixtures อยู่ใน [src/contracts](../src/contracts/) และ [fixtures](fixtures/).

## ลูกค้า

- `GET /api/venues/by-slug/{slug}` คืนข้อมูลร้านและ LIFF ID.
- `GET /api/venues/{venueId}/availability?date=YYYY-MM-DD` คืนโต๊ะตามคืนบริการ พร้อมช่วงเวลา UTC และสถานะ. ตารางนี้เป็นข้อมูล ณ เวลาที่อ่าน.
- `GET /api/venues/{venueId}/releases` คืนช่วงเปิดรับที่ร้านกำหนด.
- `POST /api/session/line` รับ `{venueSlug,idToken}` จาก LIFF และตั้ง session cookie สำหรับร้าน. `POST /api/session/logout` ยกเลิก session.
- `POST /api/booking-requests` รับ `venueId,serviceDate,partySize` และ `tableId` ในโหมด `customer_picks` หรือ `zoneId` ในโหมด `auto_assign`. ส่ง `serviceAt` (ISO timestamp) และ `contactPhone` ได้. ต้องส่ง header `Idempotency-Key`. คืน `202 {requestId}` เมื่อ broker รับแล้ว. หากรับเข้าคิวไม่สำเร็จคืน 503 และให้ลองซ้ำด้วย key เดิม. Key เดิมกับ payload ต่างคืน 422.
- `GET /api/me/booking-requests/{requestId}` คืน `{requestId,status,resultCode,bookingId}`. สถานะสิ้นสุดคือ `confirmed` หรือ `rejected`. `TABLE_UNAVAILABLE` หมายถึงโต๊ะเต็มหรือถูกปิดก่อนตัดสิน.
- `GET /api/me/bookings` คืน `{bookings}`. `GET /api/me/bookings/{bookingId}` คืน booking. `POST /api/me/bookings/{bookingId}/cancel` ยกเลิกตาม cutoff ของร้าน.

## พนักงาน

ใช้ `Authorization: Bearer <Supabase access token>`. Prefix `/api/staff/venues/{venueId}`. ข้ามร้านคืน 404. เจ้าของร้านจัดการ profile, settings, rules, releases และ LINE. พนักงานจัดการโซน/โต๊ะและการจอง.

- `GET/PATCH /` จัดการข้อมูลร้าน. `GET/PATCH /settings` กำหนดโหมดเลือกโต๊ะและ cutoff.
- `GET/POST /zones`, `GET/PATCH/DELETE /zones/{zoneId}`. `GET/POST /tables`, `GET/PATCH/DELETE /tables/{tableId}`. DELETE ปิดใช้งาน.
- `GET/PATCH /rules` เพิ่ม rule version ตาม scope. ค่าที่เป็น null สืบทอดจาก scope ถัดไป. วันอาทิตย์คือ 0.
- `GET/PUT /releases` ตั้งช่วงเปิดรับตาม service date.
- `GET/PATCH /line-integration`, `GET /booking-link` คืน LIFF URL กับ QR SVG. ค่า secret ไม่ออกจาก API.
- `GET /customers?q=...` ค้นจากชื่อหรือเลขท้ายเบอร์โทรภายในร้าน.
- `POST /booking-requests` ใช้ payload แบบลูกค้า โดยส่ง `customerId` แทน `venueId`. `GET /booking-requests/{requestId}` ดูผลภายในร้าน.
- `GET /bookings`, `GET/PATCH /bookings/{bookingId}`. PATCH รับ `{"status":"cancelled"}`.
