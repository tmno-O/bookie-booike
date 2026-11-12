"use client";

import type { KeyboardEvent } from "react";
import { centerOf, PLAN_HEIGHT, PLAN_WIDTH, type FloorPlan } from "@/lib/floor-plan";
import styles from "./floor-plan-view.module.css";

export type PlanZoneView = { name: string; disabled?: boolean; badge?: string };

type Props = {
  plan: FloorPlan;
  /** Zones that can be shown, by zone id. Shapes whose zone is missing here are left out. */
  zones: Record<string, PlanZoneView>;
  selectedId?: string;
  onSelect?: (zoneId: string) => void;
};

/** Read-only floor plan: the customer zone picker and the owner's "customer view" preview. */
export default function FloorPlanView({ plan, zones, selectedId, onSelect }: Props) {
  const pick = (zoneId: string, zone: PlanZoneView) => { if (!zone.disabled) onSelect?.(zoneId); };
  const onKey = (event: KeyboardEvent, zoneId: string, zone: PlanZoneView) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); pick(zoneId, zone); }
  };
  return (
    <svg className={styles.plan} viewBox={`0 0 ${PLAN_WIDTH} ${PLAN_HEIGHT}`} role="presentation">
      {plan.markers.map((marker) => (
        <g key={marker.id} className={styles.marker} aria-hidden="true">
          <rect x={marker.x} y={marker.y} width={marker.width} height={marker.height} rx={6} />
          <text x={marker.x + marker.width / 2} y={marker.y + marker.height / 2}>
            {marker.kind === "entrance" && !marker.label.startsWith("↑") ? `↑ ${marker.label}` : marker.label}
          </text>
        </g>
      ))}
      {plan.zones.map((shape) => {
        const zone = zones[shape.zoneId];
        if (!zone) return null;
        const center = centerOf(shape.points);
        const selected = selectedId === shape.zoneId;
        return (
          <g key={shape.zoneId} role="button" tabIndex={zone.disabled || !onSelect ? -1 : 0}
            aria-pressed={selected} aria-disabled={zone.disabled || undefined}
            aria-label={`${zone.name}${zone.badge ? ` (${zone.badge})` : ""}`}
            className={`${styles.zone} ${selected ? styles.zoneOn : ""} ${zone.disabled ? styles.zoneOff : ""}`}
            onClick={() => pick(shape.zoneId, zone)} onKeyDown={(event) => onKey(event, shape.zoneId, zone)}>
            <polygon points={shape.points.map((p) => `${p.x},${p.y}`).join(" ")} />
            <text className={styles.zoneName} x={center.x} y={center.y - (zone.badge ? 9 : 0)}>{zone.name}</text>
            {zone.badge && <text className={styles.zoneBadge} x={center.x} y={center.y + 17}>{zone.badge}</text>}
          </g>
        );
      })}
    </svg>
  );
}
