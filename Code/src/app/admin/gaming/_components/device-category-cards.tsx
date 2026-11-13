"use client";

import Link from "next/link";
import { CategoryTree } from "@/app/_components/category-tree";
import { DeviceHallPriceCell } from "@/app/admin/gaming/_components/device-hall-price";

export type DeviceCategoryCard = {
  id: string;
  name: string;
  areaName: string;
  typeId: string;
  typeName: string;
  hallReady: boolean;
  archived: boolean;
  operationalStatus: string;
  operationalLabel: string;
};

export function DeviceCategoryCards(props: {
  devices: DeviceCategoryCard[];
  currency: string;
  canManage: boolean;
  viewLabel: string;
}) {
  const groups = new Map<string, { id: string; label: string; items: DeviceCategoryCard[] }>();
  for (const device of props.devices) {
    const existing = groups.get(device.typeId);
    if (existing) existing.items.push(device);
    else groups.set(device.typeId, { id: device.typeId, label: device.typeName, items: [device] });
  }

  return (
    <div className="device-category-cards">
      <CategoryTree
      groups={[...groups.values()]}
      listClassName="record-cards category-tree-cards"
      itemKey={(device) => device.id}
      renderItem={(device) => (
        <article className="record-card">
          <h2>{device.name}</h2>
          <DeviceHallPriceCell
            deviceId={device.id}
            deviceName={device.name}
            currency={props.currency}
            hallReady={device.hallReady}
            archived={device.archived}
            operationalStatus={device.operationalStatus}
            operationalLabel={device.operationalLabel}
            canManage={props.canManage}
          />
          <p>{device.areaName}</p>
          <Link href={`/admin/gaming/devices/${device.id}`}>{props.viewLabel}</Link>
        </article>
      )}
    />
    </div>
  );
}
