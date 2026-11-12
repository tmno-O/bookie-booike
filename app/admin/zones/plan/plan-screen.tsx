"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  bounds, defaultPlan, findFreeSpot, findPlanProblem, rectangle,
  MIN_MARKER_HEIGHT, MIN_MARKER_WIDTH, PLAN_HEIGHT, PLAN_WIDTH,
  type FloorPlan, type FloorPlanState, type Marker, type Point,
} from "@/lib/floor-plan";
import FloorPlanView from "@/ui/floor-plan-view";
import { AdminShell } from "../../admin-shell";
import { adminApi, asFailure, type Staff } from "../../admin-api";
import type { ZoneRow } from "../../zone-dialog";
import adminStyles from "../../admin.module.css";
import styles from "./plan.module.css";

// Owner floor plan editor (Figma "Admin · 04 · จัดการผังร้าน", nodes 226:1172 – 226:1822).
type Tool = "select" | "draw" | "entrance" | "stage";
type Selection = { type: "zone" | "marker"; id: string };
type Drag =
  | { kind: "move-zone" | "move-marker"; id: string; start: Point; origin: FloorPlan }
  | { kind: "vertex"; id: string; index: number; origin: FloorPlan }
  | { kind: "resize-marker"; id: string; origin: FloorPlan };

const GRID = 5;
const snap = (value: number) => Math.round(value / GRID) * GRID;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const SEAT_STEPS = Array.from({ length: 10 }, (_, i) => (i + 1) * 12);
const ERRORS: Record<string, string> = {
  ZONE_NAME_TAKEN: "มีโซนชื่อนี้อยู่แล้ว",
  CAPACITY_BELOW_BOOKED: "ความจุน้อยกว่าที่จองไว้แล้ว",
  OWNER_REQUIRED: "เฉพาะเจ้าของร้านแก้ไขผังได้",
  FORBIDDEN: "เฉพาะเจ้าของร้านแก้ไขผังได้",
  UNKNOWN_ZONE: "ผังอ้างถึงโซนที่ไม่มีอยู่ในร้าน",
};
const failureText = (error: unknown) => {
  const failure = asFailure(error);
  return ERRORS[failure.code] ?? failure.message;
};

export default function PlanScreen() {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const planRef = useRef<FloorPlan | null>(null);
  const [staff, setStaff] = useState<Staff>();
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [plan, setPlan] = useState<FloorPlan>();
  const [server, setServer] = useState<FloorPlanState>();
  const [dirty, setDirty] = useState(false);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [selected, setSelected] = useState<Selection | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [drawChoice, setDrawChoice] = useState("");
  const [drawing, setDrawing] = useState<Point[]>([]);
  const [conflict, setConflict] = useState(false);
  const [preview, setPreview] = useState(false);
  const [previewPick, setPreviewPick] = useState<string>();
  const [publishing, setPublishing] = useState(false);
  const [nameEdit, setNameEdit] = useState<{ id: string; value: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const canEdit = staff?.role === "owner";
  const zoneName = (id: string) => zones.find((z) => z.id === id)?.name ?? "โซน";
  const placed = new Set(plan?.zones.map((shape) => shape.zoneId));
  const unplaced = zones.filter((zone) => !placed.has(zone.id));
  const selectedZone = selected?.type === "zone" ? zones.find((z) => z.id === selected.id) : undefined;
  const drawZone = unplaced.some((z) => z.id === drawChoice) ? drawChoice : unplaced[0]?.id ?? "";
  const nameDraft = selectedZone && nameEdit?.id === selectedZone.id ? nameEdit.value : selectedZone?.name ?? "";
  const selectedMarker = selected?.type === "marker" ? plan?.markers.find((m) => m.id === selected.id) : undefined;

  const unauthorized = useCallback((e: unknown) => {
    if (asFailure(e).status === 401) { router.replace("/admin/login"); return true; }
    return false;
  }, [router]);

  const update = (next: FloorPlan) => { planRef.current = next; setPlan(next); };
  const commit = (next: FloorPlan) => { update(next); setDirty(true); setSave("idle"); setError(""); };

  useEffect(() => {
    let active = true;
    Promise.all([
      adminApi<{ staff: Staff }>("/admin/me"),
      adminApi<{ zones: ZoneRow[] }>("/admin/zones"),
      adminApi<FloorPlanState>("/admin/floor-plan"),
    ]).then(([me, zoneList, state]) => {
      if (!active) return;
      setStaff(me.staff); setZones(zoneList.zones); setServer(state);
      update(state.plan ?? defaultPlan(zoneList.zones));
    }).catch((e) => { if (active && !unauthorized(e)) setError(failureText(e)); });
    return () => { active = false; };
  }, [unauthorized]);

  // Keep the draft saved shortly after each edit.
  useEffect(() => {
    if (!dirty || !canEdit || !plan || findPlanProblem(plan)) return;
    const timer = setTimeout(() => {
      setSave("saving");
      adminApi<FloorPlanState>("/admin/floor-plan", { method: "PUT", body: plan }).then((state) => {
        setServer(state); setSave("saved");
        if (planRef.current === plan) setDirty(false);
      }).catch((e) => { setSave("error"); if (!unauthorized(e)) setError(failureText(e)); });
    }, 800);
    return () => clearTimeout(timer);
  }, [dirty, plan, canEdit, unauthorized]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const toPoint = (event: PointerEvent<SVGElement>): Point | null => {
    const svg = svgRef.current, matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return { x: clamp(local.x, 0, PLAN_WIDTH), y: clamp(local.y, 0, PLAN_HEIGHT) };
  };

  function startDrag(event: PointerEvent<SVGElement>, drag: Drag) {
    if (!canEdit || tool !== "select" || !plan) return;
    event.stopPropagation();
    svgRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = drag;
    setSelected(drag.kind === "move-zone" ? { type: "zone", id: drag.id }
      : drag.kind === "vertex" ? { type: "zone", id: drag.id } : { type: "marker", id: drag.id });
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current, point = toPoint(event);
    if (!drag || !point) return;
    const origin = drag.origin;
    let next: FloorPlan = origin;
    if (drag.kind === "move-zone" || drag.kind === "move-marker") {
      let dx = snap(point.x - drag.start.x), dy = snap(point.y - drag.start.y);
      if (drag.kind === "move-zone") {
        const box = bounds(origin.zones.find((z) => z.zoneId === drag.id)!.points);
        dx = clamp(dx, -box.x, PLAN_WIDTH - box.x - box.width); dy = clamp(dy, -box.y, PLAN_HEIGHT - box.y - box.height);
        next = { ...origin, zones: origin.zones.map((z) => z.zoneId === drag.id ? { ...z, points: z.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : z) };
      } else {
        next = { ...origin, markers: origin.markers.map((m) => m.id === drag.id
          ? { ...m, x: clamp(m.x + dx, 0, PLAN_WIDTH - m.width), y: clamp(m.y + dy, 0, PLAN_HEIGHT - m.height) } : m) };
      }
    } else if (drag.kind === "vertex") {
      next = { ...origin, zones: origin.zones.map((z) => z.zoneId === drag.id
        ? { ...z, points: z.points.map((p, i) => i === drag.index ? { x: snap(point.x), y: snap(point.y) } : p) } : z) };
    } else {
      next = { ...origin, markers: origin.markers.map((m) => m.id === drag.id ? {
        ...m,
        width: clamp(snap(point.x) - m.x, MIN_MARKER_WIDTH, PLAN_WIDTH - m.x),
        height: clamp(snap(point.y) - m.y, MIN_MARKER_HEIGHT, PLAN_HEIGHT - m.y),
      } : m) };
    }
    update(next);
    setConflict(!!findPlanProblem(next));
  }

  function endDrag() {
    const drag = dragRef.current, current = planRef.current;
    dragRef.current = null;
    if (!drag || !current) return;
    setConflict(false);
    if (current === drag.origin) return;
    const problem = findPlanProblem(current);
    if (problem) { update(drag.origin); setError(problem.message); } else commit(current);
  }

  function addPoint(event: PointerEvent<SVGSVGElement>) {
    const point = toPoint(event);
    if (!point || !plan || !canEdit) return;
    const at = { x: snap(point.x), y: snap(point.y) };
    if (tool === "select") { setSelected(null); return; }
    if (tool === "draw") {
      if (!drawZone) return;
      const first = drawing[0];
      if (first && drawing.length >= 3 && Math.hypot(first.x - at.x, first.y - at.y) <= 12) { finishDrawing(); return; }
      setDrawing((points) => [...points, at]);
      return;
    }
    const entrance = tool === "entrance";
    const width = entrance ? 130 : 220, height = entrance ? 24 : 40;
    const marker: Marker = {
      id: `${tool}-${Math.random().toString(36).slice(2, 8)}`, kind: tool, label: entrance ? "ทางเข้า" : "เวที",
      x: clamp(snap(at.x - width / 2), 0, PLAN_WIDTH - width), y: clamp(snap(at.y - height / 2), 0, PLAN_HEIGHT - height), width, height,
    };
    commit({ ...plan, markers: [...plan.markers, marker] });
    setSelected({ type: "marker", id: marker.id }); setTool("select");
  }

  function finishDrawing() {
    if (!plan || !drawZone || drawing.length < 3) { setError("วาดอย่างน้อย 3 จุดเพื่อสร้างโซน"); return; }
    const next = { ...plan, zones: [...plan.zones, { zoneId: drawZone, points: drawing }] };
    const problem = findPlanProblem(next);
    if (problem) { setError(problem.message); return; }
    commit(next); setDrawing([]); setSelected({ type: "zone", id: drawZone }); setTool("select");
  }

  function chooseTool(next: Tool) {
    setTool(next); setDrawing([]); setError("");
    if (next !== "select") setSelected(null);
  }

  function addBox(zoneId: string) {
    if (!plan) return;
    const spot = findFreeSpot(plan, 160, 100);
    if (!spot) { setError("ไม่มีพื้นที่ว่างพอในผัง ลองย้ายหรือย่อโซนอื่นก่อน"); return; }
    commit({ ...plan, zones: [...plan.zones, { zoneId, points: rectangle(spot.x, spot.y, 160, 100) }] });
    setSelected({ type: "zone", id: zoneId });
  }

  function removeSelected() {
    if (!plan || !selected || !canEdit) return;
    commit(selected.type === "zone"
      ? { ...plan, zones: plan.zones.filter((z) => z.zoneId !== selected.id) }
      : { ...plan, markers: plan.markers.filter((m) => m.id !== selected.id) });
    setSelected(null);
  }

  function nudge(dx: number, dy: number) {
    if (!plan || !selected || !canEdit) return;
    let next = plan;
    if (selected.type === "zone") {
      const shape = plan.zones.find((z) => z.zoneId === selected.id);
      if (!shape) return;
      const box = bounds(shape.points);
      const mx = clamp(dx, -box.x, PLAN_WIDTH - box.x - box.width), my = clamp(dy, -box.y, PLAN_HEIGHT - box.y - box.height);
      next = { ...plan, zones: plan.zones.map((z) => z === shape ? { ...z, points: z.points.map((p) => ({ x: p.x + mx, y: p.y + my })) } : z) };
    } else {
      next = { ...plan, markers: plan.markers.map((m) => m.id === selected.id
        ? { ...m, x: clamp(m.x + dx, 0, PLAN_WIDTH - m.width), y: clamp(m.y + dy, 0, PLAN_HEIGHT - m.height) } : m) };
    }
    const problem = findPlanProblem(next);
    if (problem) setError(problem.message); else commit(next);
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    const step = event.shiftKey ? 20 : GRID;
    if (event.key === "Escape") { setDrawing([]); setSelected(null); setTool("select"); }
    else if (event.key === "Enter" && tool === "draw") finishDrawing();
    else if ((event.key === "Delete" || event.key === "Backspace") && selected) { event.preventDefault(); removeSelected(); }
    else if (event.key.startsWith("Arrow") && selected) {
      event.preventDefault();
      nudge(event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0);
    }
  }

  async function patchZone(zone: ZoneRow, body: { name?: string; seats?: number }) {
    try {
      const result = await adminApi<{ zone: ZoneRow }>(`/admin/zones/${zone.id}`, { method: "PATCH", body });
      setZones((list) => list.map((z) => z.id === zone.id ? { ...z, ...result.zone } : z));
      setError("");
    } catch (e) {
      if (!unauthorized(e)) setError(failureText(e));
      setNameEdit(null);
    }
  }

  async function publish() {
    if (!plan || !canEdit) return;
    const problem = findPlanProblem(plan);
    if (problem) { setError(problem.message); return; }
    setPublishing(true); setError("");
    try {
      await adminApi<FloorPlanState>("/admin/floor-plan", { method: "PUT", body: plan });
      const state = await adminApi<FloorPlanState>("/admin/floor-plan/publish", { method: "POST" });
      setServer(state); setDirty(false); setSave("saved"); setNotice("เผยแพร่ผังแล้ว ลูกค้าจะเห็นผังนี้ทันที");
    } catch (e) {
      if (!unauthorized(e)) setError(failureText(e));
    } finally { setPublishing(false); }
  }

  const unpublished = dirty || !server?.publishedAt || server.hasUnpublished;
  const previewZones = Object.fromEntries(zones.map((z) => [z.id, { name: z.name, disabled: z.status === "closed", badge: z.status === "closed" ? "ปิด" : undefined }]));
  const cls = (...names: (string | false)[]) => names.filter(Boolean).join(" ");

  return (
    <AdminShell active="/admin/zones" staff={staff}>
      <div className={adminStyles.pageHead}>
        <div>
          <h1 className={adminStyles.h1}>ผังโซนของร้าน</h1>
          <p className={adminStyles.sub}>วาดโซนอิสระ พร้อมจัดวางทางเข้าและเวทีตามผังร้าน</p>
        </div>
        <div className={adminStyles.actions}>
          <button type="button" className={`${adminStyles.btn} ${adminStyles.btnOutline}`} disabled={!plan}
            onClick={() => { setPreview((v) => !v); setPreviewPick(undefined); }}>
            {preview ? "กลับไปแก้ไข" : "ดูมุมมองลูกค้า"}
          </button>
          {canEdit && (
            <button type="button" className={`${adminStyles.btn} ${adminStyles.btnPrimary}`} onClick={() => void publish()}
              disabled={!plan || publishing || !unpublished || !!(plan && findPlanProblem(plan))}>
              {publishing ? "กำลังเผยแพร่…" : unpublished ? "เผยแพร่ผัง" : "เผยแพร่แล้ว"}
            </button>
          )}
        </div>
      </div>
      <p style={{ margin: "16px 0 0" }}>
        <Link href="/admin/zones" className={`${adminStyles.btn} ${adminStyles.btnOutline}`}>กลับไปยังโซน</Link>
      </p>
      {notice && <p role="status" className={adminStyles.notice}>{notice}</p>}
      {error && <p role="alert" className={adminStyles.error}>{error}</p>}
      {staff && !canEdit && <p className={cls(styles.banner, styles.bannerWarn)}>เฉพาะเจ้าของร้านแก้ไขและเผยแพร่ผังได้ คุณดูผังได้อย่างเดียว</p>}

      {preview && plan ? (
        <div className={styles.previewBox}>
          <p className={styles.hint}>นี่คือมุมมองที่ลูกค้าเห็น (จากผังฉบับล่าสุดนี้) แตะโซนเพื่อลองเลือก</p>
          <FloorPlanView plan={plan} zones={previewZones} selectedId={previewPick} onSelect={setPreviewPick} />
        </div>
      ) : (
        <div className={styles.layout}>
          <div>
            <div className={styles.toolbar} role="toolbar" aria-label="เครื่องมือผัง">
              <button type="button" className={cls(styles.tool, tool === "select" && styles.toolOn)} aria-pressed={tool === "select"} onClick={() => chooseTool("select")}>เลือก / ย้าย</button>
              <button type="button" className={cls(styles.tool, tool === "draw" && styles.toolOn)} aria-pressed={tool === "draw"} disabled={!canEdit || !unplaced.length} onClick={() => chooseTool("draw")}>วาดโซนอิสระ</button>
              {tool === "draw" && unplaced.length > 0 && (
                <select className={styles.toolSelect} aria-label="โซนที่จะวาด" value={drawZone} onChange={(e) => setDrawChoice(e.target.value)}>
                  {unplaced.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select>
              )}
              {tool === "draw" && <>
                <button type="button" className={styles.tool} disabled={drawing.length < 3} onClick={finishDrawing}>จบรูปทรง</button>
                <button type="button" className={styles.tool} onClick={() => setDrawing([])} disabled={!drawing.length}>ล้างจุด</button>
              </>}
              <button type="button" className={cls(styles.tool, tool === "entrance" && styles.toolOn)} aria-pressed={tool === "entrance"} disabled={!canEdit} onClick={() => chooseTool("entrance")}>เพิ่มทางเข้า</button>
              <button type="button" className={cls(styles.tool, tool === "stage" && styles.toolOn)} aria-pressed={tool === "stage"} disabled={!canEdit} onClick={() => chooseTool("stage")}>เพิ่มเวที</button>
              <span className={styles.state} role="status">
                {save === "saving" ? "กำลังบันทึกร่าง…" : save === "saved" ? "บันทึกร่างแล้ว" : save === "error" ? "บันทึกร่างไม่สำเร็จ" : dirty ? "มีการเปลี่ยนแปลง" : ""}
              </span>
            </div>

            <div className={styles.stage}>
              <p className={styles.hint}>
                {tool === "draw" ? "แตะบนผังเพื่อวางจุดของโซน แตะจุดแรกอีกครั้งหรือกดจบรูปทรงเพื่อปิดรูป · Esc ยกเลิก"
                  : tool === "entrance" || tool === "stage" ? "แตะบนผังเพื่อวางองค์ประกอบ"
                  : "เลือกองค์ประกอบเพื่อแก้ไข · ลากจุดมุมเพื่อปรับรูปทรง · ใช้ลูกศรบนคีย์บอร์ดเพื่อขยับ"}
              </p>
              {plan ? (
                <svg ref={svgRef} className={styles.canvas} viewBox={`0 0 ${PLAN_WIDTH} ${PLAN_HEIGHT}`} tabIndex={0} role="application"
                  aria-label="ผังโซนของร้าน" onPointerDown={addPoint} onPointerMove={onPointerMove}
                  onPointerUp={endDrag} onPointerCancel={endDrag} onKeyDown={onKeyDown}
                  style={{ cursor: tool === "select" ? "default" : "crosshair" }}>
                  {Array.from({ length: PLAN_WIDTH / 20 - 1 }, (_, i) => <line key={`v${i}`} className={styles.gridLine} x1={(i + 1) * 20} y1={0} x2={(i + 1) * 20} y2={PLAN_HEIGHT} />)}
                  {Array.from({ length: PLAN_HEIGHT / 20 - 1 }, (_, i) => <line key={`h${i}`} className={styles.gridLine} x1={0} y1={(i + 1) * 20} x2={PLAN_WIDTH} y2={(i + 1) * 20} />)}
                  {plan.markers.map((marker) => {
                    const isSelected = selected?.type === "marker" && selected.id === marker.id;
                    return (
                      <g key={marker.id} className={cls(styles.marker, isSelected && (conflict ? styles.conflict : styles.selected))}
                        style={{ cursor: canEdit && tool === "select" ? "move" : undefined }}
                        onPointerDown={(e) => { const start = toPoint(e); if (start) startDrag(e, { kind: "move-marker", id: marker.id, start, origin: plan }); }}>
                        <rect x={marker.x} y={marker.y} width={marker.width} height={marker.height} rx={6} />
                        <text x={marker.x + marker.width / 2} y={marker.y + marker.height / 2}>{marker.kind === "entrance" ? `↑ ${marker.label}` : marker.label}</text>
                        {isSelected && canEdit && (
                          <circle className={styles.handle} cx={marker.x + marker.width} cy={marker.y + marker.height} r={7}
                            onPointerDown={(e) => startDrag(e, { kind: "resize-marker", id: marker.id, origin: plan })} />
                        )}
                      </g>
                    );
                  })}
                  {plan.zones.map((shape) => {
                    const isSelected = selected?.type === "zone" && selected.id === shape.zoneId;
                    const box = bounds(shape.points);
                    return (
                      <g key={shape.zoneId} className={cls(styles.zone, isSelected && (conflict ? styles.conflict : styles.selected))}
                        style={{ cursor: canEdit && tool === "select" ? "move" : undefined }}
                        onPointerDown={(e) => { const start = toPoint(e); if (start) startDrag(e, { kind: "move-zone", id: shape.zoneId, start, origin: plan }); }}>
                        <polygon points={shape.points.map((p) => `${p.x},${p.y}`).join(" ")} />
                        <text x={box.x + box.width / 2} y={box.y + box.height / 2}>{zoneName(shape.zoneId)}</text>
                        {isSelected && canEdit && shape.points.map((p, index) => (
                          <circle key={index} className={styles.handle} cx={p.x} cy={p.y} r={6}
                            onPointerDown={(e) => startDrag(e, { kind: "vertex", id: shape.zoneId, index, origin: plan })} />
                        ))}
                      </g>
                    );
                  })}
                  {drawing.length > 0 && (
                    <g pointerEvents="none">
                      <polyline className={styles.drawing} points={drawing.map((p) => `${p.x},${p.y}`).join(" ")} />
                      {drawing.map((p, i) => <circle key={i} className={styles.drawPoint} cx={p.x} cy={p.y} r={i === 0 ? 6 : 4} />)}
                    </g>
                  )}
                </svg>
              ) : <p className={adminStyles.empty}>กำลังโหลด…</p>}
            </div>

            {plan && !unpublished && server?.publishedAt && (
              <div className={cls(styles.banner, styles.bannerOk)}><strong>เผยแพร่ผังแล้ว</strong><br />ลูกค้าเห็นผังนี้และสามารถแตะเลือกโซนได้</div>
            )}
            {plan && unpublished && (
              <div className={cls(styles.banner, styles.bannerWarn)}>
                {server?.publishedAt ? "มีการเปลี่ยนแปลงที่ยังไม่เผยแพร่ ลูกค้ายังเห็นผังฉบับก่อนหน้า" : "ผังนี้ยังไม่ได้เผยแพร่ ลูกค้ายังเห็นผังมาตรฐานของระบบ"}
              </div>
            )}
          </div>

          <aside className={styles.panel} aria-label="คุณสมบัติ">
            {selectedZone ? (
              <>
                <h2 className={styles.panelTitle}>คุณสมบัติโซน</h2>
                <p className={styles.panelSub}>{selectedZone.name}</p>
                <hr className={styles.panelRule} />
                <label className={styles.label} htmlFor="zone-name">ชื่อโซน</label>
                <input id="zone-name" className={styles.control} value={nameDraft} maxLength={40} disabled={!canEdit}
                  onChange={(e) => setNameEdit({ id: selectedZone.id, value: e.target.value })}
                  onBlur={() => { const name = nameDraft.trim(); if (name && name !== selectedZone.name) void patchZone(selectedZone, { name }); else setNameEdit(null); }} />
                <label className={styles.label} htmlFor="zone-seats">ความจุสูงสุด</label>
                <select id="zone-seats" className={styles.control} value={selectedZone.seats} disabled={!canEdit}
                  onChange={(e) => void patchZone(selectedZone, { seats: Number(e.target.value) })}>
                  {[...new Set([...SEAT_STEPS, selectedZone.seats])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n} คน</option>)}
                </select>
                <span className={styles.label}>ขนาดพื้นที่</span>
                <p className={styles.fact}>{(() => { const box = bounds(plan!.zones.find((z) => z.zoneId === selectedZone.id)?.points ?? [{ x: 0, y: 0 }]); return `${Math.round(box.width)} × ${Math.round(box.height)}`; })()}</p>
                <span className={styles.label}>สถานะ</span>
                <p className={cls(styles.fact, selectedZone.status === "open" && styles.ok)}>{selectedZone.status === "open" ? "เปิดให้ลูกค้าเลือกโซนนี้" : "ปิดรับจอง"}</p>
                <p className={styles.muted} style={{ marginTop: 14 }}>พื้นที่ต้องไม่ซ้อนกัน</p>
                {canEdit && <button type="button" className={`${adminStyles.btn} ${adminStyles.btnOutline}`} style={{ marginTop: 16 }} onClick={removeSelected}>ลบโซน</button>}
                {canEdit && <p className={styles.muted}>ลบออกจากผังเท่านั้น โซนและการจองยังอยู่ครบ</p>}
              </>
            ) : selectedMarker ? (
              <>
                <h2 className={styles.panelTitle}>{selectedMarker.kind === "entrance" ? "ทางเข้า" : "เวที"}</h2>
                <hr className={styles.panelRule} />
                <label className={styles.label} htmlFor="marker-label">ชื่อที่แสดง</label>
                <input id="marker-label" className={styles.control} value={selectedMarker.label} maxLength={40} disabled={!canEdit}
                  onChange={(e) => plan && commit({ ...plan, markers: plan.markers.map((m) => m.id === selectedMarker.id ? { ...m, label: e.target.value || m.label } : m) })} />
                <span className={styles.label}>ขนาด</span>
                <p className={styles.fact}>{Math.round(selectedMarker.width)} × {Math.round(selectedMarker.height)}</p>
                {canEdit && <button type="button" className={`${adminStyles.btn} ${adminStyles.btnOutline}`} style={{ marginTop: 16 }} onClick={removeSelected}>ลบ{selectedMarker.kind === "entrance" ? "ทางเข้า" : "เวที"}</button>}
              </>
            ) : (
              <>
                <h2 className={styles.panelTitle}>คุณสมบัติ</h2>
                <p className={styles.panelSub}>เลือกโซนหรือองค์ประกอบบนผังเพื่อแก้ไข</p>
                <hr className={styles.panelRule} />
                <span className={styles.label} style={{ marginTop: 0 }}>โซนที่ยังไม่อยู่ในผัง</span>
                {unplaced.length === 0 ? <p className={styles.muted}>ทุกโซนอยู่ในผังแล้ว</p> : (
                  <div className={styles.unplaced}>
                    {unplaced.map((z) => (
                      <div key={z.id} className={styles.unplacedRow}>
                        <span>{z.name}</span>
                        {canEdit && <button type="button" className={styles.tool} onClick={() => addBox(z.id)}>เพิ่มลงผัง</button>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </aside>
        </div>
      )}
    </AdminShell>
  );
}
