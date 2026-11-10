import { ApiError } from "@/lib/errors";
import { json, input, route } from "@/lib/http";
import { reset } from "@/mock/db";
import { assertMockEnabled } from "@/mock/session";
import { resetInput } from "@/mock/validation";

const parse = (text: string): unknown => {
  try { return JSON.parse(text); } catch { throw new ApiError(400, "INVALID_JSON", "Invalid JSON body"); }
};

// Test helper: restore seed data. Optional body: {"opensInSeconds":30,"queueStepSeconds":0}
export const POST = route<Record<string, string>>(async (request) => {
  assertMockEnabled();
  const text = await request.text();
  const options = input(resetInput, text.trim() ? parse(text) : {});
  await reset(options);
  return json({ ok: true, ...options });
});
