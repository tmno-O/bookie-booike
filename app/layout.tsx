import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="th"><body style={{ fontFamily: "system-ui, sans-serif", margin: "2rem auto", padding: "0 1rem", maxWidth: "42rem" }}>{children}</body></html>;
}
