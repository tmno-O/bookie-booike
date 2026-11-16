import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { auditSigner, checkpointMessage, checkpointSignatureValid, signCheckpoint } from "../audit-signing";

type CheckpointRow = { seq: string; headHash: string; signedAt: Date; keyId: string; signature: string; currentHash: string | null };

/** Signs the current head of every venue chain that moved since its last checkpoint. Runs from Cron. */
export async function createAuditCheckpoints() {
  const signer = auditSigner();
  if (!signer) throw new ApiError(503, "AUDIT_SIGNING_NOT_CONFIGURED", "Audit signing key is not configured");
  const heads = await db()<{ venueId: string; seq: string; headHash: string }[]>`
    select v.id as venue_id, h.seq::text, encode(h.row_hash, 'hex') as head_hash
    from venues v cross join lateral (
      select seq, row_hash from audit_logs a where a.venue_id = v.id order by a.seq desc limit 1
    ) h
    where h.seq > coalesce((select max(seq) from audit_checkpoints c where c.venue_id = v.id), 0)
  `;
  for (const head of heads) {
    const signedAt = new Date().toISOString();
    const signature = signCheckpoint(signer, { ...head, signedAt });
    await db()`
      insert into audit_checkpoints (venue_id, seq, head_hash, signed_at, key_id, signature)
      values (${head.venueId}, ${head.seq}, decode(${head.headHash}, 'hex'), ${signedAt}, ${signer.keyId}, ${signature})
      on conflict (venue_id, seq) do nothing
    `;
  }
  return { checkpoints: heads.length, keyId: signer.keyId };
}

/**
 * Checks every checkpoint of a venue: the signature must verify with the server key and the row at that
 * sequence must still carry the signed hash. Rewriting history inside the database breaks one of the two.
 */
export async function verifyCheckpoints(venueId: string) {
  const signer = auditSigner();
  const rows = await db()<CheckpointRow[]>`
    select c.seq::text, encode(c.head_hash, 'hex') as head_hash, c.signed_at, c.key_id, c.signature,
      encode(a.row_hash, 'hex') as current_hash
    from audit_checkpoints c left join audit_logs a on a.venue_id = c.venue_id and a.seq = c.seq
    where c.venue_id = ${venueId} order by c.seq
  `;
  const latestSeq = rows.at(-1)?.seq ?? null;
  if (!signer) return { configured: false, checked: 0, firstInvalidSeq: null, latestSeq };
  let firstInvalidSeq: string | null = null;
  for (const row of rows) {
    const fields = { venueId, seq: row.seq, headHash: row.headHash, signedAt: row.signedAt.toISOString() };
    const ok = row.keyId === signer.keyId && row.currentHash === row.headHash
      && checkpointSignatureValid(signer.publicKey, fields, row.signature);
    if (!ok) { firstInvalidSeq = row.seq; break; }
  }
  return { configured: true, checked: rows.length, firstInvalidSeq, latestSeq };
}

export async function latestCheckpoint(venueId: string) {
  const signer = auditSigner();
  const [row] = await db()<Omit<CheckpointRow, "currentHash">[]>`
    select seq::text, encode(head_hash, 'hex') as head_hash, signed_at, key_id, signature
    from audit_checkpoints where venue_id = ${venueId} order by seq desc limit 1
  `;
  if (!row) throw new ApiError(404, "NO_CHECKPOINT", "ยังไม่มีจุดตรวจที่ลงนาม");
  const fields = { venueId, seq: row.seq, headHash: row.headHash, signedAt: row.signedAt.toISOString() };
  return {
    format: "bookie-audit-checkpoint:v1", ...fields, keyId: row.keyId, signature: row.signature,
    message: checkpointMessage(fields).toString("utf8"), publicKeyPem: signer?.publicKeyPem ?? null,
  };
}
