import type { ReactNode } from "react";

export type StatusTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "accent"
  | "info"
  | "available"
  | "occupied"
  | "paused"
  | "maintenance"
  | "disabled"
  | "paid"
  | "partial"
  | "outstanding";

export function StatusChip(props: { tone?: StatusTone; children: ReactNode }) {
  const tone = props.tone ?? "neutral";
  return (
    <span className="status-chip" data-tone={tone}>
      {props.children}
    </span>
  );
}
