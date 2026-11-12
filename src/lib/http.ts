import { z } from "zod";
import { ApiError } from "./errors";

export function input<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue.path.join(".");
    throw new ApiError(400, "INVALID_INPUT", path ? `${path}: ${issue.message}` : issue.message);
  }
  return parsed.data;
}

export async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Use application/json");
  }
  const json = await request.json().catch(() => {
    throw new ApiError(400, "INVALID_JSON", "Invalid JSON body");
  });
  return input(schema, json);
}

export function json(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(data, { ...init, headers });
}

// parseEnv() lists only the names of invalid variables, never their values, so this is safe to log.
export function configIssue(error: unknown): string | undefined {
  return error instanceof Error && error.message.startsWith("Invalid server configuration:") ? error.message : undefined;
}

export function route<T extends Record<string, string>>(
  handler: (request: Request, params: T) => Promise<Response>,
) {
  return async (request: Request, context: { params: Promise<T> }) => {
    try {
      return await handler(request, await context.params);
    } catch (error) {
      if (error instanceof ApiError) {
        return json({ error: { code: error.code, message: error.message } }, { status: error.status });
      }
      console.error("API failure", error instanceof Error ? error.name : "UnknownError",
        typeof error === "object" && error && "code" in error ? error.code : undefined,
        configIssue(error));
      return json({ error: { code: "INTERNAL_ERROR", message: "Unexpected server error" } }, { status: 500 });
    }
  };
}
