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
  it("defaults to a direct database connection", () => {
    expect(parseEnv(local)).toMatchObject({ DATABASE_POOL_MAX: 10, DATABASE_PREPARE: true });
  });
  it("configures the transaction pooler", () => {
    expect(parseEnv({ ...local, DATABASE_POOL_MAX: "2", DATABASE_PREPARE: "false" }))
      .toMatchObject({ DATABASE_POOL_MAX: 2, DATABASE_PREPARE: false });
  });
  it("rejects an invalid pool size", () => {
    expect(() => parseEnv({ ...local, DATABASE_POOL_MAX: "0" })).toThrow("DATABASE_POOL_MAX");
  });
  it("requires FIFO", () => {
    expect(() => parseEnv({ ...local, SQS_QUEUE_URL: "http://localhost/standard" })).toThrow("SQS_QUEUE_URL");
  });
});
