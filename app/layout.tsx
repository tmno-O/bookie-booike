import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: { default: "Bookie lyon. · จองโต๊ะออนไลน์", template: "%s · Bookie lyon." },
  description: "จองโต๊ะผ่าน LINE ดูสถานะและจัดการการจองของคุณ",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="th"><body style={{ fontFamily: "system-ui, sans-serif", margin: "2rem auto", padding: "0 1rem", maxWidth: "42rem" }}>{children}</body></html>;
}
