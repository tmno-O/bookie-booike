import Link from "next/link";

export default function Home() {
  return <main>
    <h1>Bookie Bookie</h1>
    <p><Link href="/book/bookie-demo">ทดลองจองโต๊ะ</Link></p>
    <p><a href="/api/health">ตรวจสถานะระบบ</a></p>
  </main>;
}
