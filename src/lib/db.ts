import postgres from "postgres";
import { env } from "./env";

let sql: postgres.Sql | undefined;

export function db() {
  const config = env();
  // Supabase's transaction pooler (port 6543) does not support prepared statements.
  return sql ??= postgres(config.DATABASE_URL, {
    connect_timeout: 5,
    idle_timeout: 20,
    max: config.DATABASE_POOL_MAX,
    prepare: config.DATABASE_PREPARE,
    transform: { column: { from: postgres.toCamel } },
  });
}
