# Deploy Bookie Bookie บน Vercel และ Supabase

อัปเดต 17 พฤศจิกายน 2569 · production ที่แนะนำใช้ Vercel (เว็บ + API) กับ Supabase cloud (ฐานข้อมูล, Auth, คิว และ Cron) ด้วย `QUEUE_DRIVER=db` จึงไม่ต้องใช้ AWS SQS และไม่ต้องมี worker server

## สถานะ

| งาน | สถานะ |
| --- | --- |
| โค้ดรองรับ deploy: pooler (`DATABASE_PREPARE`, `DATABASE_POOL_MAX`), คิวใน Postgres (`QUEUE_DRIVER=db`), `vercel.json` region `sin1` | อยู่ใน `main` แล้ว (PR #3) |
| FCFS, LINE outbox และ CI | รวมเข้า `main` ใน PR #22 และ [CI ผ่าน](https://github.com/tmno-O/bookie-booike/actions/runs/43920496169) |
| Migrations ล่าสุดและ LINE drain บน production | ตรวจ schema, cron และทดสอบส่งจริงตามขั้นตอนด้านล่าง |
| Supabase cloud, Vercel project, LINE Login + LIFF | เปิดใช้งานแล้วตามข้อมูลทีม (16 พ.ย. 2569) |

## ทำไมใช้คิวใน Postgres บน Vercel

- Vercel รันโปรเซสค้างไม่ได้ จึงรัน `npm run worker` ที่ long-poll SQS ไม่ได้
- worker ทำแค่เรียก `process_booking_request()` ทีละคำขอ ซึ่งย้ายไปทำใน Postgres ได้ทั้งหมด
- ผล k6 ในเครื่อง (5,000 คำขอแย่งโต๊ะเดียว) โหมด `db` รับครบ 5,000 ใน 68.5 วินาทีไม่มี error ส่วนโหมด `sqs` ใช้ 403 วินาทีและ timeout 286 รายการ ทั้งสองโหมดจองได้ 1 รายการถูกต้อง
- ข้อจำกัด: Supabase Free เป็นคอขวดตอน burst ใหญ่ ต้องวัดบน cloud ก่อนวันจริง ถ้าไม่พอให้อัปเป็น Pro โดยไม่ต้องแก้โค้ด

## 1. Supabase cloud

1. สร้าง project region **Singapore** แล้วจดรหัสผ่าน DB ไว้
2. ลง schema จาก root ของ repo สำหรับระบบที่มีอยู่ ให้ตรวจ project ที่ link และรายการ migration ก่อนรันคำสั่ง

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
6. สร้างข้อมูลร้านและสมาชิกตามโครงสร้างใน `supabase/seed.sql` ด้วยข้อมูลจริง จากนั้นให้ owner บันทึกค่ามาตรฐานใน `/admin/hours` เพื่อให้เวลาเปิดจองและช่วงวันล่วงหน้าสอดคล้องกัน.
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
   | `DEFAULT_VENUE_SLUG` | slug ร้านเริ่มต้นสำหรับ `/` |
   | `LINE_NOTIFICATIONS_ENABLED` | `true` เมื่อพร้อมส่ง LINE ตามขั้นที่ 5 (ค่าเริ่มต้น `false`) |
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
4. Publish channel ตามขอบเขตที่ต้องการให้ลูกค้าเข้าถึง. ถ้าเปลี่ยน slug ให้ปรับทั้ง LIFF Endpoint URL, Rich Menu และ `DEFAULT_VENUE_SLUG` สำหรับร้านเริ่มต้น.

## 4. ตรวจบน cloud

- [ ] `/api/health` ตอบ `ok: true`
- [ ] เปิดลิงก์ LIFF ในแอป LINE บนมือถือ 2 เครื่อง เดินครบ: เข้าสู่ระบบ → กรอกข้อมูล → เลือกโซน → confirmed → การจองของฉัน
- [ ] Admin: login → dashboard → check-in → staff จองแทน → จัดสรรโซน
- [ ] รัน k6 บนสภาพแวดล้อมทดสอบแยก โดยเลือกโซนที่เหลือที่นั่งพอสำหรับกลุ่ม 1-4 อีกกลุ่มเดียว

## ข้อควรระวัง

- เก็บ secret ไว้ใน Vercel และ Supabase เท่านั้น ห้าม commit
- ห้ามรันโหมด `sqs` และ `db` กับฐานข้อมูลเดียวกันพร้อมกัน drain ของโหมด `db` จะหยิบคำขอ `queued` ทั้งหมด
- Vercel Hobby ใช้ได้เฉพาะงานไม่เชิงพาณิชย์
- ยังไม่มี: หน้าสมัคร owner, การรับคำเชิญ staff, รีเซ็ตรหัสผ่าน, ข้อความขอ consent PDPA สำหรับเบอร์โทร

## 5. Booking and release notifications on Vercel

Apply all pending migrations before deploying the current app. PR #22 introduced `20261117000100_fcfs_booking.sql`, `20261117000200_one_active_booking.sql`, `20261117000300_booking_opening.sql`, and `20261117000400_line_outbox_leases.sql`. Configure a Messaging API access token under the same LINE provider, `LINE_NOTIFICATIONS_ENABLED=true`, `LINE_VERIFY_MODE=real`, and a random `CRON_SECRET` of at least 32 characters in Vercel. Set `BOOKING_PUBLIC_ORIGIN` to the public HTTPS site origin if the default Vercel production domain is unsuitable for links. In-app announcements work when push is disabled.

Use one scheduler. Supabase Cron can call the existing POST endpoint every minute. Vercel Cron calls GET with `Authorization: Bearer $CRON_SECRET` and needs a plan that supports minute scheduling. Vercel Hobby supports daily jobs. See [Vercel Cron limits](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing).

Verify whether the job already exists before changing the production schedule:

```sql
select jobid, jobname, schedule, active
from cron.job where jobname = 'bookie-notifications';
```

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

The endpoint reserves roughly 20 seconds for deliveries. The worker commits an outbox lease before calling LINE and uses the same retry ID after a failure. Check Cron run history, the HTTP status from `pg_net`, and `GET /api/health` for aggregate outbox counts. Missing cron configuration returns 503, invalid credentials return 401, and disabled push preserves queued jobs. See [LINE notification audit](LINE_NOTIFICATIONS.md) for the rollout and smoke checks.

LINE customers waiting for allocation can receive a received message. Automatic or staff confirmation, cancellation, and queued rejection each have separate notifications. Owners set the lead time for confirmed bookings and special days separately in `/admin/settings/notifications`. Both default to 24 hours. Booking reminders count back from the reservation time. Special-day reminders count back from the venue's local opening time and use the audience of the published announcement. Each reminder can be disabled. Changing a setting updates upcoming reminders that have yet to be attempted. Special-day announcements are sent when published and can also appear in the booking app.

Run `npm run test:scenarios` against a migrated local Supabase database to exercise these flows with mocked LINE responses.

### Signed audit checkpoints

Generate an Ed25519 key once and store it only in Vercel as `AUDIT_SIGNING_KEY` (never in Supabase):

```bash
node -e "console.log(require('node:crypto').generateKeyPairSync('ed25519').privateKey.export({format:'der',type:'pkcs8'}).toString('base64'))"
```

Schedule the checkpoint job like the drain, for example every 15 minutes:

```sql
select cron.schedule('bookie-audit-checkpoint', '*/15 * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'bookie_app_url')
      || '/api/internal/audit/checkpoint',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'bookie_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
$job$);
```

A database administrator can rebuild the hash chain but cannot sign a new checkpoint without the Vercel key, so a rewrite shows up as an invalid checkpoint in `/admin/audit`. Owners should also download the signed checkpoint periodically; it can be checked offline with the public key it contains. Rotating the key makes earlier checkpoints report as invalid, so keep the previous key until those checkpoints are archived.

### Security headers

`next.config.ts` sends `X-Frame-Options: DENY` and `frame-ancestors 'none'` on `/admin` and `/api`, `SAMEORIGIN` elsewhere, plus `nosniff`, `Referrer-Policy`, `Permissions-Policy` and HSTS. Check them after deploy with `curl -I https://<domain>/admin/login`.

References: [Supabase scheduling with Vault and pg_net](https://supabase.com/docs/guides/functions/schedule-functions), [LINE LIFF redirect behavior](https://developers.line.biz/en/docs/liff/opening-liff-app/). LINE links restore `next=bookings` or `next=select` after LIFF initializes. The select link carries the release date.
