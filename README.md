# Bookie Bookie

ระบบจองโต๊ะผ่าน LINE OA / LIFF ใช้ Next.js, Supabase Postgres และคิว SQS FIFO. ดู [API contract](docs/API_CONTRACT.md), [fixtures](docs/fixtures/) และ [แผน backend](docs/backend-developer-calm-hinton.md).

## รันในเครื่อง

ต้องมี Node.js 22 ขึ้นไปและ Docker. เปิด Docker แล้วรันจาก root ของ repo.

```powershell
npm ci
docker compose up -d
npx supabase start -x realtime,storage-api,imgproxy,studio,edge-runtime,logflare,vector,postgres-meta,supavisor
Copy-Item .env.example .env.local
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

ใส่ผลจากคำสั่งสุดท้ายใน `LINE_SECRET_KEY` และใช้ `PUBLISHABLE_KEY` จาก `npx supabase status -o env` ใน `SUPABASE_PUBLISHABLE_KEY`. ค่าในตัวอย่างชี้ไปที่ Supabase API พอร์ต `56321`, Postgres พอร์ต `56322` และ ElasticMQ พอร์ต `9324`.

เปิดสอง terminal.

```powershell
npm run dev -- --port 3100
```

```powershell
npm run worker
```

เปิด [หน้าเดโม](http://localhost:3100/book/bookie-demo) และใช้ปุ่มเข้าสู่ระบบทดสอบ. เลือกคืนบริการ โต๊ะ และจำนวนคน. หน้าจอจะติดตามคำขอจนได้ผลจาก worker และมีปุ่มยกเลิกรายการที่เพิ่งจอง. ตรวจ DB และคิวได้ที่ [health endpoint](http://localhost:3100/api/health).

บัญชี Supabase สำหรับเดโม local คือ `owner@bookie.test` กับ `staff@bookie.test` ใช้รหัส `BookieDemo123!`. เรียก `supabase.auth.signInWithPassword` ด้วย publishable key แล้วส่ง `session.access_token` เป็น Bearer token ให้ staff API. ใช้ `npx supabase migration up` เมื่อมี migration ใหม่. สำหรับฐานข้อมูลเดโมเดิมที่ยังไม่มีบัญชีตัวอย่าง ให้รัน `npx supabase db reset --local` เมื่อพร้อมล้างข้อมูลเดโมในเครื่อง.

## ทดสอบ

```powershell
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
```

Integration tests ใช้ Supabase, ElasticMQ และ LINE mock. พัก booking worker ของเดโมระหว่างรันชุดนี้. Tests สร้างร้านและคิวแยกชั่วคราว แล้วล้างข้อมูลร้านทดสอบเมื่อจบ.

ทดสอบ HTTP spike เมื่อ dev server กับ worker ทำงาน. ตั้ง `SERVICE_DATE` เป็นคืนอนาคตที่โต๊ะ A2 ยังว่าง. ทดสอบจะสร้างการจองเดโมหนึ่งรายการ.

```powershell
$env:BASE_URL = 'http://localhost:3100'
$env:SERVICE_DATE = (Get-Date).AddDays(2).ToString('yyyy-MM-dd')
k6 run tests/load/booking-spike.js
```

## พฤติกรรมและการกู้คืน

- หนึ่งโต๊ะมี allocation active ได้หนึ่งรายการต่อคืนบริการ. ความจุโซนนับจำนวนคนจาก booking ที่ยืนยันแล้วในคืนนั้น. `auto_assign` เลือกโต๊ะว่างขนาดเล็กสุดที่จุพอ.
- วันบริการอิง timezone ร้าน. ค่าเริ่มต้นเปิดทุกวัน `18:00–02:00`, จองล่วงหน้าได้ 30 วัน, ไม่มีเวลานำขั้นต่ำ และลูกค้ายกเลิกก่อนเวลาให้บริการอย่างน้อย 120 นาที. ร้านแก้ค่าได้ผ่าน staff API. กฎระดับโต๊ะมาก่อนโซนและร้านตามลำดับ. เมื่อส่ง `serviceAt` ให้ใช้ ISO timestamp พร้อม timezone offset. เมื่อเว้นไว้ worker เลือกเวลาเร็วสุดที่กฎอนุญาต.
- `202` หมายถึง broker รับคำขอแล้ว. หากส่งคิวล้มเหลว ให้ retry ด้วย `Idempotency-Key` เดิม. Worker ตรวจ `pending_publish` ทุก 15 วินาที และสั่งตรวจทันทีได้ด้วย `npm run reconcile`.
- Worker ต่อ visibility ระหว่างประมวลผลและลบข้อความหลัง commit. เมื่อใช้จำนวน retry ครบ จะบันทึก `rejected/SYSTEM_ERROR` และ audit ก่อนลบข้อความ. ติดตาม `pending_publish`, `queued` และ `notification_outbox` จากฐานข้อมูลฝั่ง server.

## เชื่อม LINE และ SQS จริง

- ตั้ง `LINE_VERIFY_MODE=real` และตั้ง LIFF Endpoint URL เป็น `https://<host>/book/<slug>` ของร้านพร้อม scope `openid`. ตั้ง LINE Login channel ID, LIFF ID และ provider ID ผ่าน staff API ของเจ้าของร้าน. ใช้ HTTPS สำหรับ session cookie ใน production.
- ตั้ง `SQS_QUEUE_URL` ไปที่ FIFO queue, ลบ `SQS_ENDPOINT` แล้วให้ AWS credentials ของ workload มีสิทธิ์ส่ง รับ ลบ ต่อ visibility และอ่าน queue attributes. ใช้ queue เฉพาะ environment และให้ worker จัดการ poison message ตาม `BOOKING_MAX_RECEIVES`.
- เปิด LINE push โดยใส่ access token ของ Messaging API channel ที่ใช้ provider เดียวกับ LINE Login, ตั้ง `LINE_NOTIFICATIONS_ENABLED=true` แล้วรัน `npm run worker:notifications`. Worker ใช้ LINE retry key และบันทึกสถานะส่งแยกจากการจอง. เก็บ `LINE_SECRET_KEY` ไว้ใน secret store ของ environment เพื่อถอดรหัสค่าเดิมได้.
- ส่วนที่ยังต้องทดสอบกับบัญชีจริงคือ LINE Login / LIFF, LINE OA push และ AWS SQS. Rich Menu preview/publish ยังไม่รวมในงานนี้. มัดจำ การชำระเงิน และ check-in/no-show อยู่นอกขอบเขต MVP.
