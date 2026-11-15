# Deploy: Vercel + Supabase

ฉบับ 13 พฤศจิกายน 2569 · production ที่แนะนำใช้ Vercel (เว็บ + API) กับ Supabase cloud (ฐานข้อมูล, Auth, คิว และ Cron) ด้วย `QUEUE_DRIVER=db` จึงไม่ต้องใช้ AWS SQS และไม่ต้องมี worker server

## สถานะ

| งาน | สถานะ |
| --- | --- |
| โค้ดรองรับ deploy: pooler (`DATABASE_PREPARE`, `DATABASE_POOL_MAX`), คิวใน Postgres (`QUEUE_DRIVER=db`), `vercel.json` region `sin1` | อยู่ใน `main` แล้ว (PR #3) |
| หลักฐาน k6 เทียบสองโหมด | [docs/evidence](evidence/README.md) |
| Supabase cloud, Vercel project, LINE Login + LIFF | ยังไม่ได้ทำ ต้องใช้บัญชีเจ้าของ repo |

## ทำไมใช้คิวใน Postgres บน Vercel

- Vercel รันโปรเซสค้างไม่ได้ จึงรัน `npm run worker` ที่ long-poll SQS ไม่ได้
- worker ทำแค่เรียก `process_booking_request()` ทีละคำขอ ซึ่งย้ายไปทำใน Postgres ได้ทั้งหมด
- ผล k6 ในเครื่อง (5,000 คำขอแย่งโต๊ะเดียว) โหมด `db` รับครบ 5,000 ใน 68.5 วินาทีไม่มี error ส่วนโหมด `sqs` ใช้ 403 วินาทีและ timeout 286 รายการ ทั้งสองโหมดจองได้ 1 รายการถูกต้อง
- ข้อจำกัด: Supabase Free เป็นคอขวดตอน burst ใหญ่ ต้องวัดบน cloud ก่อนวันจริง ถ้าไม่พอให้อัปเป็น Pro โดยไม่ต้องแก้โค้ด

## 1. Supabase cloud

1. สร้าง project region **Singapore** แล้วจดรหัสผ่าน DB ไว้
2. ลง schema จาก root ของ repo (ลงเฉพาะ migration ไม่รัน seed):

   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push --include-all
   ```

3. Integrations → Cron เปิดใช้ แล้วรันใน SQL Editor (`drain_booking_requests` เป็น procedure ต้องใช้ `call`):

   ```sql
   select cron.schedule('drain-bookings', '1 second', 'call drain_booking_requests()');
   select cron.schedule('booking-housekeeping', '1 minute', 'select booking_housekeeping()');
   ```

4. Authentication → Sign In / Providers → Email: ปิด "Allow new users to sign up"
5. Authentication → Users → Add user (Auto Confirm) สำหรับ owner และ staff ตั้งรหัสผ่านจริงเอง
6. ใส่ข้อมูลร้านใน SQL Editor ตามรูปแบบใน `supabase/seed.sql`: `venues`, `venue_settings`, `zones`, `venue_tables`, `venue_members` (หา `user_id` จาก `auth.users` ตาม email) ตั้งเวลาเปิดจองใน `venue_settings` เช่น 1 วัน 20:00 เพราะค่าเริ่มต้นคือเปิดล่วงหน้า 365 วัน
7. Project Settings → Database → Connection string: เก็บ **Transaction pooler** (พอร์ต 6543) ไว้ใช้กับ Vercel

**ห้ามรัน `supabase/seed.sql` บน cloud** เพราะมีบัญชีและรหัสผ่านทดสอบ

## 2. Vercel

1. Import `tmno-O/bookie-booike` ด้วยบัญชีที่เข้าถึง repo ได้ (Hobby ฟรี) ตั้ง Production branch เป็น `main` และ Node.js 22 ถ้า import ไม่ได้ ให้ deploy จากเครื่องด้วย `npx vercel login`, `npx vercel link`, `npx vercel deploy --prod`
2. Environment Variables:

   | Key | ค่า |
   | --- | --- |
   | `DATABASE_URL` | Transaction pooler (พอร์ต 6543) |
   | `DATABASE_PREPARE` | `false` |
   | `DATABASE_POOL_MAX` | `2` |
   | `QUEUE_DRIVER` | `db` (ค่าเริ่มต้น ระบุไว้ให้ชัด) |
   | `SUPABASE_URL` | Project Settings → API → URL |
   | `SUPABASE_PUBLISHABLE_KEY` | Project Settings → API Keys → publishable key |
   | `NEXT_PUBLIC_API_MODE` | `real` (ฝังตอน build แก้แล้วต้อง Redeploy) |
   | `LINE_VERIFY_MODE` | `real` |
   | `LINE_SECRET_KEY` | hex 64 ตัว สร้างใหม่ด้วย `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` |
   | `LINE_NOTIFICATIONS_ENABLED` | `false` |
   | `BOOKING_RATE_LIMIT_PER_MINUTE` | `30` |
   | `BOOKING_MAX_RECEIVES` | `5` |

   ห้ามตั้ง `SQS_*` และ `MOCK_API`
3. Deploy แล้วเปิด `https://<domain>/api/health` ต้องได้ `{"ok":true,...}`
4. Supabase → Authentication → URL Configuration: ตั้ง Site URL เป็นโดเมน Vercel

## 3. LINE Login + LIFF

Production ปฏิเสธ `LINE_VERIFY_MODE=mock` ลูกค้าจึงต้อง login ผ่าน LIFF จริง

1. [LINE Developers Console](https://developers.line.biz/console/) → Provider → สร้าง channel แบบ **LINE Login**
2. LIFF → Add: Endpoint URL `https://<domain>/book/<slug>/login`, Scope `openid` และ `profile`, Size Full
3. ผูกกับร้าน: owner เรียก `PATCH /api/staff/venues/{venueId}/line-integration` ด้วย channel ID, LIFF ID และ provider ID หรือใส่ตาราง `venue_line_integrations` ใน SQL Editor
4. Publish channel ไม่อย่างนั้น login ได้เฉพาะบัญชี tester

## 4. ตรวจบน cloud

- [ ] `/api/health` ตอบ `ok: true`
- [ ] เปิดลิงก์ LIFF ในแอป LINE บนมือถือ 2 เครื่อง เดินครบ: รับคิว → เลือกโซน → confirmed → การจองของฉัน
- [ ] Admin: login → dashboard → check-in → staff จองแทน → จัดสรรโซน
- [ ] k6 burst กับโดเมนจริง ไล่ 500 → 2,000 → 5,000 ด้วยร้านทดสอบแยกแบบ `customer_picks` แล้วดู CPU และ connection ใน Supabase → Reports

## ข้อควรระวัง

- เก็บ secret ไว้ใน Vercel และ Supabase เท่านั้น ห้าม commit
- ห้ามรันโหมด `sqs` และ `db` กับฐานข้อมูลเดียวกันพร้อมกัน drain ของโหมด `db` จะหยิบคำขอ `queued` ทั้งหมด
- Vercel Hobby ใช้ได้เฉพาะงานไม่เชิงพาณิชย์
- ยังไม่มี: หน้าสมัคร owner, การรับคำเชิญ staff, รีเซ็ตรหัสผ่าน, ข้อความขอ consent PDPA สำหรับเบอร์โทร

## 5. Booking and release notifications on Vercel

Apply migrations with `npx supabase db push --include-all` (the policy migrations precede the existing floor-plan migration). Configure a Messaging API access token from the same LINE provider, `LINE_NOTIFICATIONS_ENABLED=true`, `LINE_VERIFY_MODE=real`, and a random `CRON_SECRET` of at least 32 characters in Vercel. In-app announcements work even when push is disabled or fails.

Enable `pg_cron`, `pg_net`, and Vault in Supabase. Store the application URL and the same cron secret in Vault using the dashboard (names `bookie_app_url`, `bookie_cron_secret`). Schedule one POST per minute:

```sql
select cron.schedule('bookie-notifications', '* * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'bookie_app_url')
      || '/api/internal/notifications/drain',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'bookie_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
$job$);
```

The endpoint reserves roughly 20 seconds for bounded deliveries, uses row locks to avoid overlapping workers, and retains stable LINE retry IDs. Check `net._http_response`, Cron run history, and both outboxes (`pending`, `sent`, `skipped`, `dead`). Missing cron configuration returns 503; invalid credentials return 401; disabled push preserves pending jobs. No cloud job or secret is provisioned by the migration.

References: [Supabase scheduling with Vault and pg_net](https://supabase.com/docs/guides/functions/schedule-functions), [LINE LIFF redirect behavior](https://developers.line.biz/en/docs/liff/opening-liff-app/). The LIFF link supplies `next=waiting`; customers without saved contact details complete that step first.
