// Floor plan geometry shared by the API validation, the admin editor and the customer view.
// Coordinates live in a fixed 600 x 420 canvas; the SVG scales it to any screen.

export const PLAN_WIDTH = 600;
export const PLAN_HEIGHT = 420;
/** Smallest allowed zone, roughly 20 x 20 canvas units. */
export const MIN_ZONE_AREA = 400;
export const MIN_MARKER_WIDTH = 40;
export const MIN_MARKER_HEIGHT = 20;
const GRID_STEP = 5;
const EPSILON = 1e-6;

export type Point = { x: number; y: number };
export type ZoneShape = { zoneId: string; points: Point[] };
export type Marker = {
  id: string; kind: "entrance" | "stage"; label: string; x: number; y: number; width: number; height: number;
};
export type FloorPlan = { zones: ZoneShape[]; markers: Marker[] };
export type FloorPlanState = { plan: FloorPlan | null; publishedAt: string | null; hasUnpublished: boolean };

export function polygonArea(points: Point[]) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function bounds(points: Point[]) {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** True when the two segments cross at a single interior point (touching ends or collinear overlap do not count). */
function segmentsCross(a: Point, b: Point, c: Point, d: Point) {
  return cross(a, b, c) * cross(a, b, d) < -EPSILON && cross(c, d, a) * cross(c, d, b) < -EPSILON;
}

function onSegment(p: Point, a: Point, b: Point) {
  if (Math.abs(cross(a, b, p)) > 1e-3) return false;
  return p.x >= Math.min(a.x, b.x) - EPSILON && p.x <= Math.max(a.x, b.x) + EPSILON
    && p.y >= Math.min(a.y, b.y) - EPSILON && p.y <= Math.max(a.y, b.y) + EPSILON;
}

/** Strictly inside: points on the border are outside, so zones may share an edge. */
export function pointInPolygon(p: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (onSegment(p, a, b)) return false;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** A polygon whose edges never cross each other. */
export function isSimplePolygon(points: Point[]) {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsCross(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) return false;
    }
  }
  return true;
}

const boxesApart = (a: Point[], b: Point[]) => {
  const p = bounds(a), q = bounds(b);
  return p.x + p.width <= q.x || q.x + q.width <= p.x || p.y + p.height <= q.y || q.y + q.height <= p.y;
};

/** Do the interiors of two polygons overlap? Shared edges and corners are fine. */
export function polygonsOverlap(a: Point[], b: Point[]) {
  if (boxesApart(a, b)) return false;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segmentsCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
    }
  }
  // No crossing edges: one polygon may sit inside the other (or be identical), so sample the shared area.
  const box = bounds(a);
  for (let x = Math.floor(box.x / GRID_STEP) * GRID_STEP + GRID_STEP / 2; x < box.x + box.width; x += GRID_STEP) {
    for (let y = Math.floor(box.y / GRID_STEP) * GRID_STEP + GRID_STEP / 2; y < box.y + box.height; y += GRID_STEP) {
      const point = { x, y };
      if (pointInPolygon(point, a) && pointInPolygon(point, b)) return true;
    }
  }
  return false;
}

export type PlanProblem = { code: "SHAPE_INVALID" | "ZONES_OVERLAP" | "DUPLICATE_ZONE" | "MARKER_OUT_OF_BOUNDS" | "DUPLICATE_MARKER"; zoneId?: string; message: string };

/** First structural problem in a plan, or null when it can be saved. Pure, so the editor can use it live. */
export function findPlanProblem(plan: FloorPlan): PlanProblem | null {
  const seen = new Set<string>();
  for (const zone of plan.zones) {
    if (seen.has(zone.zoneId)) return { code: "DUPLICATE_ZONE", zoneId: zone.zoneId, message: "มีโซนซ้ำในผัง" };
    seen.add(zone.zoneId);
    if (polygonArea(zone.points) < MIN_ZONE_AREA || !isSimplePolygon(zone.points)) {
      return { code: "SHAPE_INVALID", zoneId: zone.zoneId, message: "รูปทรงโซนไม่ถูกต้องหรือเล็กเกินไป" };
    }
  }
  for (let i = 0; i < plan.zones.length; i++) {
    for (let j = i + 1; j < plan.zones.length; j++) {
      if (polygonsOverlap(plan.zones[i].points, plan.zones[j].points)) {
        return { code: "ZONES_OVERLAP", zoneId: plan.zones[j].zoneId, message: "พื้นที่โซนต้องไม่ซ้อนกัน" };
      }
    }
  }
  const markerIds = new Set<string>();
  for (const marker of plan.markers) {
    if (markerIds.has(marker.id)) return { code: "DUPLICATE_MARKER", message: "มีองค์ประกอบซ้ำในผัง" };
    markerIds.add(marker.id);
    if (marker.x < 0 || marker.y < 0 || marker.x + marker.width > PLAN_WIDTH + EPSILON || marker.y + marker.height > PLAN_HEIGHT + EPSILON
      || marker.width < MIN_MARKER_WIDTH || marker.height < MIN_MARKER_HEIGHT) {
      return { code: "MARKER_OUT_OF_BOUNDS", message: "ตำแหน่งหรือขนาดองค์ประกอบอยู่นอกผัง" };
    }
  }
  return null;
}

export const rectangle = (x: number, y: number, width: number, height: number): Point[] => [
  { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
];

/** First free spot (scanning the canvas) for a rectangle of the given size, or null when the plan is full. */
export function findFreeSpot(plan: FloorPlan, width: number, height: number): Point | null {
  for (let y = 60; y + height <= PLAN_HEIGHT - 40; y += 10) {
    for (let x = 10; x + width <= PLAN_WIDTH - 10; x += 10) {
      const candidate = rectangle(x, y, width, height);
      if (!plan.zones.some((zone) => polygonsOverlap(zone.points, candidate))) return { x, y };
    }
  }
  return null;
}

/** Starting layout for a venue that has zones but no plan yet: a stage on top, zones in a row, an entrance below. */
export function defaultPlan(zones: { id: string }[]): FloorPlan {
  const plan: FloorPlan = {
    zones: [],
    markers: [
      { id: "stage", kind: "stage", label: "เวที", x: 190, y: 12, width: 220, height: 40 },
      { id: "entrance-main", kind: "entrance", label: "ทางเข้าหลัก", x: 235, y: 384, width: 130, height: 24 },
    ],
  };
  const columns = Math.min(3, Math.max(1, zones.length));
  const cellWidth = Math.floor(560 / columns);
  zones.slice(0, 12).forEach((zone, index) => {
    const column = index % columns, row = Math.floor(index / columns);
    plan.zones.push({
      zoneId: zone.id,
      points: rectangle(20 + column * cellWidth, 70 + row * 150, cellWidth - 20, 130),
    });
  });
  return findPlanProblem(plan) ? { zones: [], markers: plan.markers } : plan;
}

/** Combines the stored draft and published copies into what the staff screen needs. */
export function floorPlanState(draft: FloorPlan | null, published: FloorPlan | null, publishedAt: string | null): FloorPlanState {
  return {
    plan: draft,
    publishedAt: published ? publishedAt : null,
    hasUnpublished: draft !== null && JSON.stringify(draft) !== JSON.stringify(published),
  };
}

export const centerOf = (points: Point[]): Point => {
  const box = bounds(points);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
