import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

const local = {
  DATABASE_URL: "postgresql://localhost:54322/postgres",
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_PUBLISHABLE_KEY: "local-key",
  SQS_QUEUE_URL: "http://localhost:9324/000000000000/test.fifo",
  LINE_SECRET_KEY: "ab".repeat(32),
  LINE_VERIFY_MODE: "mock",
};

describe("server configuration", () => {
  it("allows mock LINE outside production", () => expect(parseEnv(local).LINE_VERIFY_MODE).toBe("mock"));
  it("blocks mock LINE in production", () => {
    expect(() => parseEnv({ ...local, NODE_ENV: "production" })).toThrow("LINE_VERIFY_MODE");
  });
  it("requires FIFO", () => {
    expect(() => parseEnv({ ...local, SQS_QUEUE_URL: "http://localhost/standard" })).toThrow("SQS_QUEUE_URL");
  });
});
