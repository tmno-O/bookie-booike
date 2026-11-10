import postgres from "postgres";
import { env } from "./env";

let sql: postgres.Sql | undefined;

export function db() {
  return sql ??= postgres(env().DATABASE_URL, {
    connect_timeout: 5,
    idle_timeout: 20,
    max: 10,
    transform: { column: { from: postgres.toCamel } },
  });
}
