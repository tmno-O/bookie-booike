import { z } from "zod";

export const partyBucket = z.enum(["1-4", "5-8", "9-12", "12+"]);
export type PartyBucket = z.infer<typeof partyBucket>;
export const partySizeFor: Record<PartyBucket, number> = { "1-4": 4, "5-8": 8, "9-12": 12, "12+": 15 };

export function bucketForPartySize(size: number): PartyBucket {
  return partyBucket.options.find((bucket) => size <= partySizeFor[bucket]) ?? "12+";
}
