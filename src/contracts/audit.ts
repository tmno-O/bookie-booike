import { z } from "zod";
import { instant, serviceDate } from "./common";

const sequence = z.string().regex(/^\d+$/);
export const auditQuery = z.object({
  date: serviceDate.optional(), q: z.string().trim().max(80).default(""),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(2147483647).default(0),
});
export const verifyQuery = z.object({ from: sequence.optional(), to: sequence.optional() })
  .refine((v) => !v.from || !v.to || BigInt(v.from) <= BigInt(v.to), "from must not exceed to")
  .refine((v) => [v.from, v.to].every((n) => !n || BigInt(n) <= 9223372036854775807n), "Sequence exceeds bigint range");
export const auditEntry = z.object({
  id: sequence, seq: sequence, action: z.string(), createdAt: instant, actor: z.string(),
  ticketSeq: sequence.nullable(), queueSeq: sequence.nullable(), receivedAt: instant.nullable(), decidedAt: instant.nullable(),
  resultCode: z.string().nullable(), reference: z.string().nullable(), phone: z.string(),
  tableId: z.string().nullable(), zoneId: z.string().nullable(), rowHash: z.string(),
  tableName: z.string().nullable(), zoneName: z.string().nullable(),
});
export const auditPage = z.object({ date: serviceDate, entries: z.array(auditEntry), nextOffset: z.number().int().nullable() });
export type AuditEntry = z.infer<typeof auditEntry>;
