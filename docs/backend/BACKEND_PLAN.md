# แผนงาน Backend และ API contract

5 พฤศจิกายน 2569 · ฉบับ Feature 1–4 + LIFF/FIFO | ผู้ใช้รับบทบาท Backend | เอกสารออกแบบ ยังไม่มีระบบเปิดใช้งาน ไม่มีผล pilot/load test หรือธุรกรรมจริงที่ยืนยันแล้ว

## 1. งานที่คุณรับผิดชอบ

API/schema/RPC, OA integration ต่อร้าน, identity/permissions, rules engine, FIFO/admission recovery, payment/refund adapters, worker/outbox, audit และ integration/load tests Frontend รับ LIFF/staff UI ตาม contract เดียวกัน Research/Product ปิดคำถามกับร้าน/ผู้สอน

## 2. แบบจำลองข้อมูล

| กลุ่ม | ตารางและหน้าที่ |
| --- | --- |
| ร้าน/สิทธิ์ | venues, venue_members: ชื่อ Maps timezone owner/staff |
| LINE รายร้าน | venue_line_integrations, onboarding_choices, rich_menu_jobs: provider/channel/LIFF ID, credential refs, capability และ consent |
| ลูกค้า | customers, customer_identities(provider_id, subject), venue_customers, customer_sessions: ไม่ค้นทั้ง LINE/ไม่รวมข้ามร้านด้วยชื่อ |
| โซน/โต๊ะ/ไฟล์ | zones, venue_tables, asset_metadata: ชื่อ ราคา optional capacity proposal รูปประกอบที่มี ownership |
| กฎ/เวลา | booking_rules, table_rule_overrides, service_nights, booking_releases: effective version, เปิดขายกับเวลารับบริการแยกกัน |
| คิว | booking_requests, idempotency_keys: actor/source/hash/pending_publish/sequence/result |
| การจอง | bookings, booking_allocations: policy snapshot, contact ที่จำเป็น, active range; check-in เป็นข้อเสนอ D16 |
| เงิน | deposit_policies, payment_attempts, payments, payment_events: settlement/provider mapping/duplicate |
| คืนเงิน/จ่ายออก | refund_requests, refund_events, payout_records: entitlement ไม่เท่ากับการโอนจริง |
| การทำงาน | notification_outbox, audit_logs, booking_events: retry/lease/ผู้แก้/หลักฐาน; check_in_events เมื่อยืนยัน D16 |


บังคับ tenant foreign keys และความสัมพันธ์ร้าน/โซน/โต๊ะ/คืนให้ตรงกัน ใช้ integer สตางค์ UTC timestamptz แสดง Asia/Bangkok และ version/snapshot กติกา ลูกค้าอ่านเฉพาะของตน Staff เฉพาะ venue_members ที่มีสิทธิ์ Secret/privileged DB client อยู่ server/worker เท่านั้น

## 3. API ฉบับเสนอ

| Method / path | ผู้เรียก | พฤติกรรม |
| --- | --- | --- |
| POST /api/session/line | ลูกค้า | ตรวจ token ด้วย configuration/provider ที่ถูกต้อง ออก session |
| POST /api/session/logout | ลูกค้า | revoke session |
| GET /api/venues/by-slug/{slug} | Public | ข้อมูลร้าน Maps โซน กติกาที่เปิดเผยได้ |
| GET /api/venues/{venueId}/availability | Public/ลูกค้า | snapshot ตามคืน จำนวนคนและ effective rules |
| GET /api/venues/{venueId}/releases | Public | วันเวลาเปิดรับและ policy version |
| POST /api/booking-requests | ลูกค้า | ตรวจและ publish FIFO คืน 202/requestId |
| GET /api/me/booking-requests/{requestId} | เจ้าของคำขอ | สถานะ/ผล/bookingId เดิม |
| GET /api/me/bookings[ /{bookingId} ] | เจ้าของรายการ | อ่านประวัติและรายละเอียดของตน |
| POST /api/me/bookings/{bookingId}/cancellation-preview | เจ้าของรายการ | คำนวณสิทธิ์คืนจาก snapshot และเวลาจริง |
| POST /api/me/bookings/{bookingId}/cancel | เจ้าของรายการ | ยกเลิก/ปล่อยโต๊ะ/สร้าง refund entitlement แบบ atomic |
| GET/PATCH /api/staff/venues/{venueId}/line-integration | Owner | ตั้ง capability/provider/token refs และตรวจ connection |
| GET /api/staff/venues/{venueId}/booking-link | Owner | URL/QR จาก LIFF config |
| POST /api/staff/venues/{venueId}/rich-menu-preview | Owner | preview 3 ปุ่มยังไม่ publish |
| POST /api/staff/venues/{venueId}/rich-menu-publish | Owner | เฉพาะเลือกใช้/เปลี่ยนและมี explicit confirmation/version |
| GET/POST/PATCH /api/staff/venues/{venueId}/zones[ /{zoneId} ] | ตาม role | กฎโซนและข้อมูลที่ผ่าน validation |
| GET/POST/PATCH /api/staff/venues/{venueId}/tables[ /{tableId} ] | ตาม role | โต๊ะภายในโซน ราคา optional และสถานะ |
| GET/PATCH /api/staff/venues/{venueId}/rules | Owner | กฎรายโซน/โต๊ะและเวอร์ชัน |
| POST /api/staff/venues/{venueId}/assets | Owner | ไฟล์โลโก้/ผัง ตรวจ ownership/type/size |
| GET /api/staff/venues/{venueId}/customers | Staff | ค้นเฉพาะ known customers ร้าน |
| POST /api/staff/venues/{venueId}/booking-requests | Staff | จองแทนใน FIFO เดียวกัน actor/source จาก server |
| GET/PATCH /api/staff/venues/{venueId}/bookings[ /{bookingId} ] | ตาม role | อ่าน/จัดการรายการเดิม ยกเลิกโดยร้านมีสิทธิ์คืนเต็ม |
| POST /api/staff/venues/{venueId}/check-ins | Staff | ข้อเสนอ D16; token + atomic transition สแกนซ้ำได้ผลเดิม |
| POST /api/payments | เจ้าของ/ตาม role | attempt สำหรับ hold จริง ไม่สร้าง charge ซ้ำเมื่อ timeout |
| GET /api/payments/{paymentId} | เจ้าของ/ร้านที่มีสิทธิ์ | เงิน/คืน/จ่ายออกที่กรองแล้ว |
| POST /api/webhooks/line/{integrationId} | LINE | raw signature/destination/channel + event dedup |
| POST /api/webhooks/payments/{provider} | Provider | durable inbox ตรวจ provider mapping ก่อน finalize/refund |


วงเล็บเหลี่ยมในตารางใช้ย่อหลาย route ไม่ใช่ URL literal รายชื่อ API เป็นแบบออกแบบ ยังไม่มี endpoint จริง เงิน/ตัวตน/source/นโยบายคำนวณจาก server ไม่เชื่อ browser

## 4. ธุรกรรมและสถานะ

- รับคำขอ: pending_publish / queued / decided; ผล processing / held / confirmed / rejected
- Booking: pending_payment / confirmed / checked_in / completed / expired / cancelled / no_show
- Payment settlement: pending / paid / failed; allocation อาจเป็น paid_unallocated
- Refund: eligible / not_eligible / requested / processing / refunded / failed; เก็บเหตุผล/ยอด/idempotency
- Payout: แยก pending/scheduled/paid/failed เมื่อ provider/เส้นทางรองรับ ห้ามอ้าง paid settlement เท่ากับจ่ายเข้าร้าน

Worker ตรวจ actor และ effective rules ซ้ำ ล็อกคืน/โต๊ะ/booking ด้วยลำดับคงที่ สร้าง allocation + booking + result + outbox ที่เกี่ยวข้องพร้อมกัน ใช้ unique active โต๊ะ/คืน และ exclusion range; เมื่อโต๊ะไม่ว่างให้ rejected/TABLE_UNAVAILABLE หลัง 202 ใช้ status API ตอบ 200 พร้อมผล ไม่ย้อน response เดิม

Cancellation RPC คำนวณสิทธิ์/ปล่อย allocation/บันทึก audit/refund request อย่าง atomic ส่วน provider call อยู่นอก transaction ใช้ operation key กันคืนซ้ำเช่นเดียวกับรับเงิน

Check-in/รายการประจำวันเป็นข้อเสนอ D16 ยังไม่ยืนยัน Phase 1 หากไม่เก็บสถานะมาถึงที่เชื่อถือได้ต้องปิด arrival auto-release เมื่อทีมเลือกใช้จึงกำหนด no-show/auto-release ตามค่าร้าน ตรวจ confirmed/not checked_in ภายใต้ lock เดียวกับ check-in เพื่อไม่ปล่อยโต๊ะที่มาถึงแล้ว

## 5. Integration และ recovery

SQS หนึ่งกลุ่มต่อ venue/service_night ทุกผู้ขอ inventory ใช้กลุ่มเดียวกัน Worker แยก container ทำเรียงในกลุ่ม ack หลัง DB commit มี visibility/lease/fencing และ retry หัวคิวตามกติกา Registry/SQS ไม่ใช่ transaction เดียว ต้องกู้ publish ที่ไม่ทราบผลได้ SQS dedup 5 นาทีไม่แทน DB idempotency

Notification ใช้ OA ของ venue ตาม provider mapping ที่ตรวจแล้ว แยก outbox worker หาก LINE API accepted ไม่อ้าง delivered/read โดยไม่มีหลักฐาน webhook/rich menu ของร้านเดิมต้องไม่ถูกทับเงียบ ๆ

Payment adapter ต้องประกาศ capabilities เช่น supports_refund, supports_partial_refund, supports_marketplace/payout และ mode test/live ไม่เปิด paid/refundable policy ใน production ถ้าเส้นทางรับ/คืนยังไม่ผ่าน readiness ที่ทีมยืนยัน Sandbox เป็นงานทดสอบ ไม่ใช้แทนเงินจริง

## 6. แผนและ Definition of done

| ระยะ | งาน Backend | ตรวจผ่าน |
| --- | --- | --- |
| ก่อนพัฒนา | ปิด provider/menu และ D01–D15 ที่จำเป็น เลือก sandbox/เงินจริง | contract/rule precedence/refund table ไม่ขัดกัน |
| แกนข้อมูล | LINE identity, staff role, venue/zones/tables/rules/assets | tenant isolation และ upload/known-customer scope |
| จอง | release/draft/API/FIFO/worker/SQL/result | ไม่ลัดคิว ไม่ oversell retry/worker crash กู้ได้ |
| เงิน/หน้าร้าน | 3 modes/cancel/refund adapter/outbox; check-in/no-show automation รอ D16 | ครบทุกช่อง refund matrix และ race cases ที่เลือกใช้ |
| ก่อน pilot | mobile/spike/security/recovery/runbook | capacity ที่ทดสอบจริง readiness เงินและ OA ร้าน |


กำหนดการรายวิชาเดิม 9–17 พ.ย. พัฒนา/18 พ.ย. นำเสนอรอยืนยัน ไม่ใช้คำว่า 11 วันในไฟล์แนบเป็นตารางใหม่อัตโนมัติ ใช้ fixtures ให้ Frontend ทำงานขนานได้ ไม่สมมติว่าคุณรับ UI ทั้งหมด

ต้องทดสอบ onboarding 3 ทางและไม่มี menu mutation เมื่อ keep, provider ต่างกัน, name collision, กฎโซน/โต๊ะขัดกัน, ปิดโต๊ะมี booking, no-show แข่ง check-in, cancellation/refund boundary, late/duplicate/out-of-order payment, broker ack/DB commit crash, retry หลัง 5 นาที, FIFO และ k6 spike ก่อนอ้างเสถียร

ดู [BACKEND_FEATURE_STACK.md](./BACKEND_FEATURE_STACK.md), [FEATURE_REQUIREMENTS.md](./FEATURE_REQUIREMENTS.md), [COST_PLAN.md](./COST_PLAN.md)
