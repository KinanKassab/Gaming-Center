"use client";

import { CategoryTree } from "@/app/_components/category-tree";
import { StatusBadge } from "@/app/_components/page-ui";
import { FloorDeviceActions } from "@/app/admin/gaming/_components/floor-device-actions";
import { ElapsedTimer } from "@/app/admin/gaming/_components/elapsed-timer";
import { occupancyLabel, operationalStatusLabel, sessionStatusLabel } from "@/app/_lib/display";
import type { AppLocale } from "@/i18n/locales";
import { t } from "@/i18n/t";
import type { FloorDevice } from "@/modules/gaming";

export function FloorCategoryTree(props: {
  tiles: FloorDevice[];
  floorNowMs: number;
  canStart: boolean;
  canOperate: boolean;
  canCancel: boolean;
  startNativeAction: string;
  customers: Array<{ id: string; displayName: string }>;
  moveTargets: Array<{ id: string; code: string; name: string }>;
  locale: AppLocale;
}) {
  const groups = new Map<string, { id: string; label: string; items: FloorDevice[] }>();
  for (const tile of props.tiles) {
    const existing = groups.get(tile.deviceType.id);
    if (existing) existing.items.push(tile);
    else groups.set(tile.deviceType.id, { id: tile.deviceType.id, label: tile.deviceType.name, items: [tile] });
  }

  const occupancyRank = (occupancy: FloorDevice["occupancy"]) =>
    occupancy === "OCCUPIED" ? 0 : occupancy === "AVAILABLE" ? 1 : 2;

  const sortedGroups = [...groups.values()].map((group) => ({
    ...group,
    items: [...group.items].sort((a, b) => occupancyRank(a.occupancy) - occupancyRank(b.occupancy)),
  }));

  return (
    <CategoryTree
      groups={sortedGroups}
      listClassName="floor-grid"
      itemKey={(tile) => tile.deviceId}
      renderItem={(tile) => (
        <article key={tile.deviceId} className={`floor-tile occupancy-${tile.occupancy.toLowerCase()}`}>
          <header className="floor-tile-head">
            <h2>{tile.name}</h2>
            <div className="floor-tile-badges">
              <StatusBadge
                tone={
                  tile.occupancy === "AVAILABLE" ? "success" : tile.occupancy === "OCCUPIED" ? "warning" : "neutral"
                }
              >
                {occupancyLabel(tile.occupancy, props.locale)}
              </StatusBadge>
              {tile.operationalStatus === "MAINTENANCE" ? (
                <StatusBadge tone="warning">{operationalStatusLabel("MAINTENANCE", props.locale)}</StatusBadge>
              ) : null}
            </div>
          </header>
          <p className="floor-tile-meta">
            {tile.area.name}
            <span aria-hidden="true"> · </span>
            {tile.deviceType.name}
          </p>
          {tile.session ? (
            <p className="floor-tile-session">
              <span>{sessionStatusLabel(tile.session.session.status, props.locale)}</span>
              <span>{tile.session.customerDisplayName ?? t(props.locale, "floor.guest")}</span>
              <ElapsedTimer
                startedAt={
                  tile.session.session.startedAt instanceof Date
                    ? tile.session.session.startedAt.toISOString()
                    : String(tile.session.session.startedAt)
                }
                status={tile.session.session.status}
                currentPauseStartedAt={tile.session.currentPauseStartedAt}
                initialNowMs={props.floorNowMs}
              />
            </p>
          ) : null}
          <FloorDeviceActions
            tile={tile}
            canStart={props.canStart}
            canOperate={props.canOperate}
            canCancel={props.canCancel}
            startNativeAction={props.startNativeAction}
            customers={props.customers}
            moveTargets={tile.session ? props.moveTargets.filter((device) => device.id !== tile.deviceId) : []}
          />
        </article>
      )}
    />
  );
}
