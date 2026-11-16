import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { env } from "@/lib/env";

export type Signer = { privateKey: KeyObject; publicKey: KeyObject; keyId: string; publicKeyPem: string };
export type CheckpointFields = { venueId: string; seq: string; headHash: string; signedAt: string };

let cached: { raw: string; signer: Signer } | undefined;

/** The Ed25519 key that signs audit checkpoints, or null when AUDIT_SIGNING_KEY is not configured. */
export function auditSigner(): Signer | null {
  const raw = env().AUDIT_SIGNING_KEY;
  if (!raw) return null;
  if (cached?.raw === raw) return cached.signer;
  const privateKey = createPrivateKey({ key: Buffer.from(raw, "base64"), format: "der", type: "pkcs8" });
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Invalid server configuration: AUDIT_SIGNING_KEY must be Ed25519");
  const publicKey = createPublicKey(privateKey);
  const spki = publicKey.export({ format: "der", type: "spki" });
  const signer = {
    privateKey, publicKey, keyId: createHash("sha256").update(spki).digest("hex").slice(0, 16),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
  };
  cached = { raw, signer };
  return signer;
}

/** The exact bytes that are signed. Anyone with the public key can rebuild and check them offline. */
export function checkpointMessage({ venueId, seq, headHash, signedAt }: CheckpointFields) {
  return Buffer.from(`bookie-audit-checkpoint:v1:${venueId}:${seq}:${headHash}:${signedAt}`, "utf8");
}

export function signCheckpoint(signer: Signer, fields: CheckpointFields) {
  return sign(null, checkpointMessage(fields), signer.privateKey).toString("base64");
}

export function checkpointSignatureValid(publicKey: KeyObject, fields: CheckpointFields, signature: string) {
  try { return verify(null, checkpointMessage(fields), publicKey, Buffer.from(signature, "base64")); }
  catch { return false; }
}
