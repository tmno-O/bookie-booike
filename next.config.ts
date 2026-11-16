import type { NextConfig } from "next";

const baseHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Browsers ignore HSTS on plain-HTTP localhost, so this is safe in development too.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

// Admin and API responses must never be framed (clickjacking). The customer LIFF pages open in
// LINE's in-app browser rather than a frame, so they only refuse foreign framing.
const noFraming = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
];
const sameOriginFraming = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
];

const config: NextConfig = {
  agentRules: false,
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: [...baseHeaders, ...sameOriginFraming] },
      { source: "/admin/:path*", headers: noFraming },
      { source: "/admin", headers: noFraming },
      { source: "/api/:path*", headers: noFraming },
    ];
  },
};

export default config;
