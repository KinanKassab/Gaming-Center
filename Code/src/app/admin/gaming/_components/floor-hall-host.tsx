"use client";

import { useDeferredValue, useId, useMemo, useState, type ReactNode } from "react";
import { EmptyState } from "@/app/_components/page-ui";
import { IconSearch } from "@/app/_components/icons";
import { FloorCategoryTree } from "@/app/admin/gaming/_components/floor-category-tree";
import type { AppLocale } from "@/i18n/locales";
import type { FloorDevice } from "@/modules/gaming";
import { matchesSmartDeviceSearch } from "@/ui/smart-device-search";

export function FloorHallHost(props: {
  filterFields: ReactNode;
  filterSubmitLabel: string;
  searchLabel: string;
  searchPlaceholder: string;
  emptyTitle: string;
  searchEmptyTitle: string;
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
  const searchId = useId();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const visibleTiles = useMemo(
    () =>
      props.tiles.filter((tile) =>
        matchesSmartDeviceSearch(
          {
            name: tile.name,
            code: tile.code,
            areaName: tile.area.name,
            deviceTypeName: tile.deviceType.name,
          },
          deferredQuery,
        ),
      ),
    [props.tiles, deferredQuery],
  );

  return (
    <>
      <section className="card floor-hall-bar">
        <div className="floor-hall-bar-search">
          <label htmlFor={searchId}>{props.searchLabel}</label>
          <div className="floor-hall-search-field">
            <IconSearch className="floor-hall-search-icon" />
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={props.searchPlaceholder}
              autoComplete="off"
              enterKeyHint="search"
              spellCheck={false}
            />
          </div>
        </div>

        <form method="get" className="floor-hall-bar-filters">
          {props.filterFields}
          <button type="submit" className="btn-secondary">
            {props.filterSubmitLabel}
          </button>
        </form>
      </section>

      {visibleTiles.length === 0 ? (
        <EmptyState title={deferredQuery.trim() ? props.searchEmptyTitle : props.emptyTitle} />
      ) : (
        <FloorCategoryTree
          tiles={visibleTiles}
          floorNowMs={props.floorNowMs}
          canStart={props.canStart}
          canOperate={props.canOperate}
          canCancel={props.canCancel}
          startNativeAction={props.startNativeAction}
          customers={props.customers}
          moveTargets={props.moveTargets}
          locale={props.locale}
        />
      )}
    </>
  );
}
