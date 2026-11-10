import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "./env";

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function encryptSecret(value: string, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(env().LINE_SECRET_KEY, "hex"), iv);
  cipher.setAAD(Buffer.from(context));
  return Buffer.concat([iv, cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64url");
}

export function decryptSecret(value: string, context: string) {
  const bytes = Buffer.from(value, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(env().LINE_SECRET_KEY, "hex"), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString("utf8");
}
