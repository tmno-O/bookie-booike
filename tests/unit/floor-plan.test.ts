import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as resetDb } from "../../app/api/mock/reset/route";
import { POST as staffLogin } from "../../app/api/mock/admin/login/route";
import { GET as staffPlan, PUT as savePlan } from "../../app/api/mock/admin/floor-plan/route";
import { POST as publishPlan } from "../../app/api/mock/admin/floor-plan/publish/route";
import { GET as customerPlan } from "../../app/api/mock/floor-plan/route";
import { floorPlan } from "../../src/contracts/floor-plan";
import {
  defaultPlan, findFreeSpot, findPlanProblem, isSimplePolygon, polygonArea, polygonsOverlap, rectangle, type FloorPlan,
} from "../../src/lib/floor-plan";

const dir = await mkdtemp(path.join(tmpdir(), "floor-plan-db-"));
process.env.MOCK_DB_PATH = path.join(dir, "db.json");
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("floor plan geometry", () => {
  it("measures polygon area and spots self-crossing shapes", () => {
    expect(polygonArea(rectangle(0, 0, 100, 50))).toBe(5000);
    const bowtie = [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }];
    expect(isSimplePolygon(bowtie)).toBe(false);
    expect(isSimplePolygon(rectangle(0, 0, 50, 50))).toBe(true);
  });

  it("detects overlap, containment and identical zones but allows shared edges", () => {
    const a = rectangle(0, 0, 100, 100);
    expect(polygonsOverlap(a, rectangle(50, 50, 100, 100))).toBe(true);
    expect(polygonsOverlap(a, rectangle(20, 20, 30, 30))).toBe(true);
    expect(polygonsOverlap(a, rectangle(0, 0, 100, 100))).toBe(true);
    expect(polygonsOverlap(a, rectangle(100, 0, 100, 100))).toBe(false);
    expect(polygonsOverlap(a, rectangle(200, 200, 50, 50))).toBe(false);
  });

  it("handles concave zones: a notch leaves room for a neighbour", () => {
    const l = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 50 }, { x: 50, y: 50 }, { x: 50, y: 200 }, { x: 0, y: 200 }];
    expect(polygonsOverlap(l, rectangle(100, 100, 80, 80))).toBe(false);
    expect(polygonsOverlap(l, rectangle(10, 100, 30, 30))).toBe(true);
  });

  it("builds a valid default layout and finds free space", () => {
    const plan = defaultPlan([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]);
    expect(plan.zones).toHaveLength(4);
    expect(findPlanProblem(plan)).toBeNull();
    expect(floorPlan.safeParse(plan).success).toBe(true);
    const spot = findFreeSpot({ zones: [], markers: [] }, 160, 100);
    expect(spot).not.toBeNull();
  });
});

describe("floor plan contract", () => {
  const valid: FloorPlan = {
    zones: [{ zoneId: "zone-vip", points: rectangle(10, 60, 200, 100) }],
    markers: [{ id: "stage", kind: "stage", label: "เวที", x: 200, y: 10, width: 200, height: 40 }],
  };

  it("accepts a normal plan", () => { expect(floorPlan.safeParse(valid).success).toBe(true); });

  it.each([
    ["a point outside the canvas", { ...valid, zones: [{ zoneId: "z", points: rectangle(500, 60, 200, 100) }] }],
    ["overlapping zones", { ...valid, zones: [...valid.zones, { zoneId: "zone-b", points: rectangle(100, 100, 200, 100) }] }],
    ["the same zone twice", { ...valid, zones: [...valid.zones, ...valid.zones] }],
    ["a zone with two points", { ...valid, zones: [{ zoneId: "z", points: rectangle(0, 0, 10, 10).slice(0, 2) }] }],
    ["a tiny zone", { ...valid, zones: [{ zoneId: "z", points: rectangle(0, 0, 5, 5) }] }],
    ["an unknown field", { ...valid, extra: true }],
    ["a marker with a bad id", { ...valid, markers: [{ ...valid.markers[0], id: "<script>" }] }],
    ["a marker off the canvas", { ...valid, markers: [{ ...valid.markers[0], x: 590 }] }],
    ["too many zones", { ...valid, zones: Array.from({ length: 51 }, (_, i) => ({ zoneId: `z${i}`, points: rectangle(0, 0, 30, 30) })) }],
  ])("rejects %s", (_name, plan) => { expect(floorPlan.safeParse(plan).success).toBe(false); });
});

describe("mock floor plan API", () => {
  const call = (handler: (r: Request, c: { params: Promise<never> }) => Promise<Response>, url: string,
    init: { method?: string; body?: unknown; cookie?: string } = {}) =>
    handler(new Request(`http://t${url}`, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json", ...(init.cookie && { cookie: init.cookie }) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }), { params: Promise.resolve({} as never) });
  const login = async (email: string) => {
    const res = await call(staffLogin, "/api/mock/admin/login", { method: "POST", body: { email } });
    return res.headers.get("set-cookie")!.split(";")[0];
  };
  const plan: FloorPlan = {
    zones: [{ zoneId: "zone-vip", points: rectangle(20, 70, 300, 120) }, { zoneId: "zone-indoor", points: rectangle(20, 220, 200, 120) }],
    markers: [{ id: "door", kind: "entrance", label: "ทางเข้าหลัก", x: 235, y: 384, width: 130, height: 24 }],
  };

  beforeEach(async () => { await call(resetDb, "/api/mock/reset", { method: "POST", body: {} }); });

  it("requires a staff login", async () => {
    expect((await call(staffPlan, "/api/mock/admin/floor-plan")).status).toBe(401);
  });

  it("starts empty, saves a draft, and shows customers nothing until it is published", async () => {
    const owner = await login("owner@bookie.test");
    expect(await (await call(staffPlan, "/api/mock/admin/floor-plan", { cookie: owner })).json())
      .toEqual({ plan: null, publishedAt: null, hasUnpublished: false });

    const saved = await call(savePlan, "/api/mock/admin/floor-plan", { method: "PUT", body: plan, cookie: owner });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ plan, publishedAt: null, hasUnpublished: true });
    expect(await (await call(customerPlan, "/api/mock/floor-plan")).json()).toEqual({ plan: null });

    const published = await (await call(publishPlan, "/api/mock/admin/floor-plan/publish", { method: "POST", cookie: owner })).json();
    expect(published).toMatchObject({ plan, hasUnpublished: false });
    expect(typeof published.publishedAt).toBe("string");
    expect(await (await call(customerPlan, "/api/mock/floor-plan")).json()).toEqual({ plan });
  });

  it("keeps the published plan while a newer draft is being edited", async () => {
    const owner = await login("owner@bookie.test");
    await call(savePlan, "/api/mock/admin/floor-plan", { method: "PUT", body: plan, cookie: owner });
    await call(publishPlan, "/api/mock/admin/floor-plan/publish", { method: "POST", cookie: owner });
    const edited = { ...plan, markers: [] };
    const state = await (await call(savePlan, "/api/mock/admin/floor-plan", { method: "PUT", body: edited, cookie: owner })).json();
    expect(state.hasUnpublished).toBe(true);
    expect(await (await call(customerPlan, "/api/mock/floor-plan")).json()).toEqual({ plan });
  });

  it("lets staff read the plan but not change or publish it", async () => {
    const staff = await login("staff@bookie.test");
    expect((await call(staffPlan, "/api/mock/admin/floor-plan", { cookie: staff })).status).toBe(200);
    expect((await call(savePlan, "/api/mock/admin/floor-plan", { method: "PUT", body: plan, cookie: staff })).status).toBe(403);
    expect((await call(publishPlan, "/api/mock/admin/floor-plan/publish", { method: "POST", cookie: staff })).status).toBe(403);
  });

  it("rejects invalid plans, unknown zones, and publishing without a draft", async () => {
    const owner = await login("owner@bookie.test");
    const overlapping = { ...plan, zones: [plan.zones[0], { zoneId: "zone-indoor", points: rectangle(100, 100, 200, 100) }] };
    expect((await call(savePlan, "/api/mock/admin/floor-plan", { method: "PUT", body: overlapping, cookie: owner })).status).toBe(400);
    const unknown = { ...plan, zones: [{ zoneId: "nope", points: rectangle(20, 70, 100, 100) }] };
    const res = await call(savePlan, "/api/mock/admin/floor-plan", { method: "PUT", body: unknown, cookie: owner });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("UNKNOWN_ZONE");
    const none = await call(publishPlan, "/api/mock/admin/floor-plan/publish", { method: "POST", cookie: owner });
    expect(none.status).toBe(409);
  });
});
