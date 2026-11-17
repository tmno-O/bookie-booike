import { describe, expect, it } from "vitest";
import { buildLineChecks, explainLineError, lineReport, type LineFacts } from "@/server/services/line-health";

const ready: LineFacts = {
  integration: { providerId: "provider", channelId: "2012596651", liffId: "2012596651-abc" },
  token: "valid", bot: { name: "Bookie", basicId: "@bookie" },
  verifyReal: true, pushEnabled: true, cronSecret: true, scheduler: "found", backlog: 0,
  friends: { checked: 3, friends: 3 },
  deliveries: { total: 5, sent: 5, failed: 0, topError: null },
};
const status = (facts: LineFacts) => Object.fromEntries(buildLineChecks(facts).map((check) => [check.id, check.status]));

describe("LINE readiness checklist", () => {
  it("passes every step for a fully configured venue and links to the OA", () => {
    const report = lineReport(ready);
    expect(report.ready).toBe(true);
    expect(report.checks.map((check) => check.status)).toEqual(["ok", "ok", "ok", "ok", "ok", "ok"]);
    expect(report.bot?.addFriendUrl).toBe("https://line.me/R/ti/p/%40bookie");
  });

  it("explains the production case: no token, so every notice was skipped", () => {
    const report = lineReport({ ...ready, token: "missing", bot: null, friends: null,
      deliveries: { total: 34, sent: 0, failed: 34, topError: "LINE_PUSH_NOT_CONFIGURED" } });
    expect(report.ready).toBe(false);
    expect(status({ ...ready, token: "missing", bot: null, friends: null })).toMatchObject({ token: "fail", friends: "unknown" });
    const deliveries = report.checks.find((check) => check.id === "deliveries")!;
    expect(deliveries).toMatchObject({ status: "fail" });
    expect(deliveries.detail).toContain(explainLineError("LINE_PUSH_NOT_CONFIGURED"));
    expect(report.checks.find((check) => check.id === "token")!.fix).toContain("Messaging API");
  });

  it("flags a LIFF from another channel, disabled push and a missing scheduler", () => {
    expect(status({ ...ready, integration: { ...ready.integration!, liffId: "999-abc" } }).login).toBe("fail");
    expect(status({ ...ready, integration: null }).login).toBe("fail");
    const server = buildLineChecks({ ...ready, pushEnabled: false }).find((check) => check.id === "server")!;
    expect(server).toMatchObject({ status: "fail" });
    expect(server.fix).toContain("LINE_NOTIFICATIONS_ENABLED=true");
    expect(status({ ...ready, cronSecret: false }).scheduler).toBe("fail");
    expect(status({ ...ready, scheduler: "missing" }).scheduler).toBe("fail");
    expect(status({ ...ready, backlog: 2 }).scheduler).toBe("warn");
    expect(status({ ...ready, scheduler: "unknown" }).scheduler).toBe("unknown");
  });

  it("reports customers who cannot receive messages from this OA", () => {
    expect(status({ ...ready, friends: { checked: 4, friends: 0 } }).friends).toBe("fail");
    expect(status({ ...ready, friends: { checked: 4, friends: 2 } }).friends).toBe("warn");
    expect(status({ ...ready, friends: { checked: 0, friends: 0 } }).friends).toBe("unknown");
    expect(status({ ...ready, token: "unavailable", bot: null }).friends).toBe("unknown");
    // A step that could not be checked does not block readiness.
    expect(lineReport({ ...ready, token: "unavailable", bot: null }).ready).toBe(true);
    // Some customers without the OA as a friend is advice, not a blocker.
    expect(lineReport({ ...ready, friends: { checked: 4, friends: 2 } }).ready).toBe(true);
  });

  it("names unknown LINE errors by their HTTP status", () => {
    expect(explainLineError("LINE_HTTP_418")).toBe("LINE ตอบกลับรหัส 418");
    expect(explainLineError(null)).toBe("ไม่ทราบสาเหตุ");
  });
});
