import { z } from "zod";
import { findPlanProblem, PLAN_HEIGHT, PLAN_WIDTH } from "@/lib/floor-plan";

const point = z.strictObject({
  x: z.number().finite().min(0).max(PLAN_WIDTH),
  y: z.number().finite().min(0).max(PLAN_HEIGHT),
});
const zoneShape = z.strictObject({
  zoneId: z.string().min(1).max(64),
  points: z.array(point).min(3).max(24),
});
const marker = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  kind: z.enum(["entrance", "stage"]),
  label: z.string().trim().min(1).max(40),
  x: z.number().finite().min(0).max(PLAN_WIDTH),
  y: z.number().finite().min(0).max(PLAN_HEIGHT),
  width: z.number().finite().positive().max(PLAN_WIDTH),
  height: z.number().finite().positive().max(PLAN_HEIGHT),
});

/** A venue floor plan: free-form zone shapes plus entrance and stage markers on a fixed 600 x 420 canvas. */
export const floorPlan = z.strictObject({
  zones: z.array(zoneShape).max(30),
  markers: z.array(marker).max(20),
}).superRefine((plan, context) => {
  const problem = findPlanProblem(plan);
  if (problem) context.addIssue({ code: "custom", message: problem.message, path: ["zones"] });
});

export const floorPlanState = z.object({
  plan: floorPlan.nullable(),
  publishedAt: z.string().nullable(),
  hasUnpublished: z.boolean(),
});
export const publicFloorPlan = z.object({ plan: floorPlan.nullable() });
