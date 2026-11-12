"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { api, realApiMode, saveCustomer, type LineUser } from "../flow";
import styles from "./details.module.css";

// Step 1: collect booker details, keep them for the queue request on the next screen.
export default function DetailsForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [name, setName] = useState(realApiMode ? "" : "เจ๊ม่อน");
  const [phone, setPhone] = useState(realApiMode ? "" : "0919119911");
  const [error, setError] = useState("");
  const [user, setUser] = useState<LineUser>();

  // Requires a LINE session (api() redirects to /login on 401); prefill the name from the LINE profile.
  useEffect(() => {
    let active = true;
    api<{ user: LineUser }>("/me").then((r) => { if (active) { setUser(r.user); setName(r.user.displayName); } }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function logout() {
    await api("/line/logout", { method: "POST" }).catch(() => undefined);
    router.push(`/book/${slug}/login`);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const clean = { name: name.trim(), phone: phone.trim() };
    if (!clean.name) return setError("กรุณากรอกชื่อลูกค้า");
    if (!/^0\d{8,9}$/.test(clean.phone)) return setError("เบอร์โทรศัพท์ต้องเป็นตัวเลข 9–10 หลัก ขึ้นต้นด้วย 0");
    saveCustomer(clean);
    router.push(`/book/${slug}/waiting`);
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <div className={styles.body}>
        <p className={styles.step}>ขั้นตอน 1 จาก 4</p>
        <h1 className={styles.title}>ข้อมูลผู้จอง</h1>
        <p className={styles.subtitle}>ใช้สำหรับติดต่อและยืนยันการจอง</p>
        <div className={styles.fields}>
          <div>
            <label className={styles.label} htmlFor="name">ชื่อลูกค้า</label>
            <input id="name" className={styles.input} value={name} maxLength={80} autoComplete="name"
              onChange={(e) => { setName(e.target.value); setError(""); }} />
          </div>
          <div>
            <label className={styles.label} htmlFor="phone">เบอร์โทรศัพท์</label>
            <input id="phone" className={styles.input} value={phone} type="tel" inputMode="tel" autoComplete="tel"
              onChange={(e) => { setPhone(e.target.value); setError(""); }} />
          </div>
        </div>
        {error ? <p role="alert" className={styles.error}>{error}</p> : !realApiMode && <p className={styles.hint}>ข้อมูลตัวอย่างสำหรับทดลองต้นแบบ</p>}
        {user && <p className={styles.hint}>เข้าสู่ระบบด้วย LINE: {user.displayName} · <button type="button" className={styles.linkButton} onClick={logout}>ออกจากระบบ</button></p>}
      </div>
      <div className={styles.footer}>
        <button type="submit" className={styles.cta}>ดำเนินการต่อ</button>
      </div>
    </form>
  );
}
