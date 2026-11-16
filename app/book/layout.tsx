import type { Viewport } from "next";
import type { ReactNode } from "react";
import NoZoom from "./no-zoom";

// The customer booking flow is a fixed-size mobile screen (LIFF), so pinch and double-tap zoom are disabled here.
// Staff/admin pages keep normal zoom.
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

export default function BookLayout({ children }: { children: ReactNode }) {
  return <><NoZoom />{children}</>;
}
