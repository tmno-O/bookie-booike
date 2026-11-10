"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AdminShell } from "../admin-shell";
import TeamDialog from "../team-dialog";
import { adminApi, asFailure, type Staff } from "../admin-api";
import styles from "../admin.module.css";

type Profile = { name: string; phone: string; address: string; entryPolicy: string };

// Staff shop settings (Figma "Admin · 06 · ตั้งค่าร้าน", node 131:623)
export default function SettingsScreen() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff>();
  const [profile, setProfile] = useState<Profile>();
  const [canEdit, setCanEdit] = useState(false);
  const [team, setTeam] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => adminApi<{ profile: Profile; canEdit: boolean }>("/admin/settings")
    .then((r) => { setProfile(r.profile); setCanEdit(r.canEdit); })
    .catch((e) => { if (asFailure(e).status === 401) router.replace("/admin/login"); else setError(asFailure(e).message); }), [router]);

  useEffect(() => {
    let active = true;
    adminApi<{ staff: Staff }>("/admin/me").then((r) => active && setStaff(r.staff))
      .catch((e) => active && asFailure(e).status === 401 && router.replace("/admin/login"));
    const first = setTimeout(() => void load(), 0);
    return () => { active = false; clearTimeout(first); };
  }, [load, router]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const set = (key: keyof Profile) => (e: { target: { value: string } }) => setProfile((p) => p && { ...p, [key]: e.target.value });

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!profile) return;
    if (!profile.name.trim()) return setError("กรุณากรอกชื่อร้าน");
    setBusy(true); setError("");
    try {
      const r = await adminApi<{ profile: Profile }>("/admin/settings", { method: "PUT", body: profile });
      setProfile(r.profile); setNotice("บันทึกการเปลี่ยนแปลงแล้ว");
      window.dispatchEvent(new Event("shop-profile-changed"));
    } catch (err) {
      const f = asFailure(err);
      setError(f.status === 400 ? "ข้อมูลไม่ถูกต้อง ตรวจสอบเบอร์โทรและความยาวของข้อความ" : f.message);
    } finally { setBusy(false); }
  }

  const input = (id: string, label: string, key: keyof Profile, full = false) => (
    <div className={full ? "full" : undefined} style={full ? { gridColumn: "1 / -1" } : undefined}>
      <label className={styles.fieldLabelStrong} htmlFor={id}>{label}</label>
      <input id={id} className={styles.input} value={profile?.[key] ?? ""} onChange={set(key)} readOnly={!canEdit} disabled={!profile} />
    </div>
  );

  return (
    <AdminShell active="/admin/settings" staff={staff}>
      <h1 className={styles.h1}>ตั้งค่าร้าน</h1>
      <p className={styles.sub}>ข้อมูลร้านและนโยบายการจอง</p>
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {profile && !canEdit && <p className={styles.readOnly}>เฉพาะเจ้าของร้านที่แก้ไขการตั้งค่าร้านได้</p>}
      <hr className={styles.divider} style={{ marginBottom: 0 }} />

      <form className={styles.settingsGrid} onSubmit={save} noValidate>
        <div className={styles.stack}>
          <section className={styles.card} aria-labelledby="shop-title">
            <h2 id="shop-title" className={styles.cardTitle} style={{ fontSize: 17 }}>ข้อมูลร้าน</h2>
            <p className={styles.cardSub} style={{ fontSize: 13 }}>ข้อมูลที่ลูกค้าเห็นในหน้าจอง</p>
            <div className={styles.fieldsGrid}>
              {input("shop-name", "ชื่อร้าน", "name")}
              {input("shop-phone", "เบอร์โทรติดต่อ", "phone")}
              {input("shop-address", "ที่อยู่ร้าน", "address", true)}
            </div>
          </section>
          <section className={styles.card} aria-labelledby="policy-title">
            <h2 id="policy-title" className={styles.cardTitle} style={{ fontSize: 17 }}>นโยบายการจอง</h2>
            <p className={styles.cardSub} style={{ fontSize: 13 }}>ข้อมูลสำหรับแจ้งลูกค้าก่อนยืนยันการจอง</p>
            <div style={{ marginTop: 26 }}>
              <label className={styles.fieldLabelStrong} htmlFor="entry-policy">นโยบายการเข้าร้าน</label>
              <input id="entry-policy" className={styles.input} value={profile?.entryPolicy ?? ""} onChange={set("entryPolicy")} readOnly={!canEdit} disabled={!profile} />
            </div>
            {canEdit && (
              <div className={styles.saveRow}>
                <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy || !profile}>{busy ? "กำลังบันทึก…" : "บันทึกการเปลี่ยนแปลง"}</button>
              </div>
            )}
          </section>
        </div>
        <section className={styles.card} aria-labelledby="team-card-title">
          <h2 id="team-card-title" className={styles.cardTitle} style={{ fontSize: 17 }}>ทีมและสิทธิ์</h2>
          <p className={styles.cardSub} style={{ fontSize: 13 }}>เจ้าของร้านจัดการสิทธิ์พนักงานได้</p>
          <hr className={styles.divLine} />
          <button type="button" className={styles.editLink} style={{ fontWeight: 500 }} onClick={() => setTeam(true)}>จัดการทีมและสิทธิ์ ›</button>
        </section>
      </form>

      {team && <TeamDialog onClose={() => setTeam(false)} onInvited={(m) => { setTeam(false); setNotice(m); }} />}
    </AdminShell>
  );
}
