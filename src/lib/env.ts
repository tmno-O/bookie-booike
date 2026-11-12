import { z } from "zod";

const httpUrl = z.url({ protocol: /^https?$/ });
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DATABASE_PREPARE: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  SUPABASE_URL: httpUrl,
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SQS_REGION: z.string().min(1).default("us-east-1"),
  SQS_ENDPOINT: httpUrl.optional(),
  QUEUE_DRIVER: z.enum(["db", "sqs"]).default("db"),
  SQS_QUEUE_URL: httpUrl.refine((url) => new URL(url).pathname.endsWith(".fifo")).optional(),
  LINE_VERIFY_MODE: z.enum(["real", "mock"]).default("real"),
  LINE_SECRET_KEY: z.string().regex(/^[0-9a-f]{64}$/i),
  LINE_NOTIFICATIONS_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  BOOKING_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),
  BOOKING_MAX_RECEIVES: z.coerce.number().int().min(1).max(100).default(5),
}).refine((env) => env.QUEUE_DRIVER !== "sqs" || env.SQS_QUEUE_URL, {
  path: ["SQS_QUEUE_URL"],
  message: "SQS_QUEUE_URL is required when QUEUE_DRIVER=sqs",
}).refine((env) => env.NODE_ENV !== "production" || env.LINE_VERIFY_MODE !== "mock", {
  path: ["LINE_VERIFY_MODE"],
  message: "Mock LINE verification is forbidden in production",
});

export function parseEnv(input: Record<string, string | undefined>) {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid server configuration: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }
  return result.data;
}

let config: ReturnType<typeof parseEnv> | undefined;

export function env() {
  return config ??= parseEnv(process.env);
}
