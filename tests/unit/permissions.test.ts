import { expect, it } from "vitest";
import { requireOwner, requireSameOrigin } from "@/lib/auth/permissions";

it("rejects mutations originating from another site", () => {
  expect(() => requireSameOrigin(new Request("https://bookie.test", {
    headers: { origin: "https://other.test" },
  }))).toThrow("Same-origin request required");
});

it("rejects owner-only mutations by staff", () => {
  expect(() => requireOwner({ userId: "staff", venueId: "venue", role: "staff" }))
    .toThrow("Venue owner permission required");
});
