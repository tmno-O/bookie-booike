import { ApiError } from "@/lib/errors";
import { route } from "@/lib/http";
import { assertMockEnabled } from "@/mock/session";
import { requireOwner } from "@/mock/staff";

// Mock mode has no signing key, so there is never a signed checkpoint to download.
export const GET = route(async (request) => {
  assertMockEnabled(); requireOwner(request);
  throw new ApiError(404, "NO_CHECKPOINT", "โหมดจำลองไม่มีจุดตรวจที่ลงนาม");
});
