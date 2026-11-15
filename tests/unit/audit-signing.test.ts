import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ AUDIT_SIGNING_KEY: undefined as string | undefined }));
vi.mock("@/lib/env", () => ({ env: () => config }));
afterEach(() => { config.AUDIT_SIGNING_KEY = undefined; });

it("signs checkpoints with Ed25519 and rejects any changed field or a foreign key", async () => {
  const { auditSigner, checkpointSignatureValid, signCheckpoint } = await import("@/server/audit-signing");
  expect(auditSigner()).toBeNull();
  const der = (key: ReturnType<typeof generateKeyPairSync>["privateKey"]) => key.export({ format: "der", type: "pkcs8" }).toString("base64");
  config.AUDIT_SIGNING_KEY = der(generateKeyPairSync("ed25519").privateKey);
  const signer = auditSigner()!;
  expect(signer.keyId).toMatch(/^[0-9a-f]{16}$/);
  const fields = { venueId: randomUUID(), seq: "42", headHash: "ab".repeat(32), signedAt: new Date().toISOString() };
  const signature = signCheckpoint(signer, fields);
  expect(checkpointSignatureValid(signer.publicKey, fields, signature)).toBe(true);
  for (const change of [{ seq: "43" }, { headHash: "cd".repeat(32) }, { signedAt: new Date(0).toISOString() }, { venueId: randomUUID() }]) {
    expect(checkpointSignatureValid(signer.publicKey, { ...fields, ...change }, signature)).toBe(false);
  }
  expect(checkpointSignatureValid(signer.publicKey, fields, "not-a-signature")).toBe(false);
  config.AUDIT_SIGNING_KEY = der(generateKeyPairSync("ed25519").privateKey);
  expect(checkpointSignatureValid(auditSigner()!.publicKey, fields, signature)).toBe(false);
  config.AUDIT_SIGNING_KEY = der(generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey);
  expect(() => auditSigner()).toThrow("Ed25519");
});

it("sends anti-framing and hardening headers, strictest on admin and API paths", async () => {
  const { default: config } = await import("../../next.config");
  const rules = await config.headers!();
  const find = (source: string) => rules.find((rule) => rule.source === source)!.headers;
  expect(find("/:path*").map((h) => h.key)).toEqual(expect.arrayContaining(["X-Content-Type-Options", "Referrer-Policy", "Strict-Transport-Security"]));
  for (const source of ["/admin", "/admin/:path*", "/api/:path*"]) {
    expect(find(source)).toContainEqual({ key: "X-Frame-Options", value: "DENY" });
    expect(find(source).find((h) => h.key === "Content-Security-Policy")!.value).toContain("frame-ancestors 'none'");
  }
});
