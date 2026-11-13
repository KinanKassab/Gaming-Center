export type FieldHelpRect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

export type FieldHelpPlacementInput = {
  trigger: FieldHelpRect;
  panelSize: { width: number; height: number };
  viewport: { width: number; height: number };
  dir: "rtl" | "ltr";
  margin?: number;
  gap?: number;
  topInset?: number;
  bottomInset?: number;
};

export type FieldHelpPlacement = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  inlineAlign: "start" | "end";
  blockAlign: "below" | "above";
};

export const FIELD_HELP_PANEL_WIDTH_PX = 288;
export const FIELD_HELP_MARGIN_PX = 8;
export const FIELD_HELP_GAP_PX = 6;

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Collision-aware FieldHelp coordinates (BUG-014).
 * Prefer below + inline-start, then flip, then clamp inside the viewport.
 * Does not require overflow:visible on the workspace.
 */
export function placeFieldHelpPanel(input: FieldHelpPlacementInput): FieldHelpPlacement {
  const margin = input.margin ?? FIELD_HELP_MARGIN_PX;
  const gap = input.gap ?? FIELD_HELP_GAP_PX;
  const topInset = input.topInset ?? 0;
  const bottomInset = input.bottomInset ?? 0;
  const minX = margin;
  const maxX = input.viewport.width - margin;
  const minY = margin + topInset;
  const maxY = input.viewport.height - margin - bottomInset;

  const width = Math.max(0, Math.min(input.panelSize.width, maxX - minX));
  const availableHeight = Math.max(0, maxY - minY);
  const maxHeight = availableHeight;

  const startLeft = input.dir === "ltr" ? input.trigger.left : input.trigger.right - width;
  const endLeft = input.dir === "ltr" ? input.trigger.right - width : input.trigger.left;

  function overflowsX(left: number): boolean {
    return left < minX || left + width > maxX;
  }

  let left: number;
  let inlineAlign: "start" | "end";
  if (!overflowsX(startLeft)) {
    left = startLeft;
    inlineAlign = "start";
  } else if (!overflowsX(endLeft)) {
    left = endLeft;
    inlineAlign = "end";
  } else {
    left = clamp(startLeft, minX, Math.max(minX, maxX - width));
    inlineAlign = "start";
  }

  const spaceBelow = maxY - input.trigger.bottom;
  const spaceAbove = input.trigger.top - minY;
  const needed = Math.min(input.panelSize.height, availableHeight);
  const blockAlign: "below" | "above" =
    spaceBelow >= needed || spaceBelow >= spaceAbove ? "below" : "above";

  const panelHeight = Math.min(input.panelSize.height, maxHeight);
  let top =
    blockAlign === "below" ? input.trigger.bottom + gap : input.trigger.top - gap - panelHeight;
  top = clamp(top, minY, Math.max(minY, maxY - panelHeight));

  return {
    top,
    left,
    width,
    maxHeight,
    inlineAlign,
    blockAlign,
  };
}

export function readDocumentDir(dir: string | null | undefined): "rtl" | "ltr" {
  return dir === "rtl" ? "rtl" : "ltr";
}
