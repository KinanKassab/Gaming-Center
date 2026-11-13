"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { IconInfo } from "@/app/_components/icons";
import { useT } from "@/i18n/provider";
import {
  FIELD_HELP_PANEL_WIDTH_PX,
  placeFieldHelpPanel,
  readDocumentDir,
  type FieldHelpPlacement,
} from "@/ui/field-help-placement";

function canHoverFine(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function measureBottomInset(): number {
  const nav = document.querySelector<HTMLElement>(".app-bottom-nav");
  if (!nav) return 0;
  const style = window.getComputedStyle(nav);
  if (style.display === "none" || style.visibility === "hidden") return 0;
  return nav.getBoundingClientRect().height;
}

export function FieldHelp(props: { title: string; what: string; choose: string; example: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [box, setBox] = useState<FieldHelpPlacement | null>(null);
  const panelId = useId();
  const root = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | null>(null);
  const skipFocusOpen = useRef(false);

  function clearTimer() {
    if (hoverTimer.current != null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }

  function openFromHover() {
    if (!canHoverFine()) return;
    clearTimer();
    hoverTimer.current = window.setTimeout(() => setOpen(true), 120);
  }

  function closeFromHover() {
    if (!canHoverFine() || pinned) return;
    clearTimer();
    hoverTimer.current = window.setTimeout(() => setOpen(false), 160);
  }

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        setPinned(false);
        setBox(null);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        skipFocusOpen.current = true;
        setOpen(false);
        setPinned(false);
        setBox(null);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    function update() {
      const triggerEl = triggerRef.current;
      const panelEl = panelRef.current;
      if (!triggerEl || !panelEl) return;
      const trigger = triggerEl.getBoundingClientRect();
      const measured = panelEl.getBoundingClientRect();
      const next = placeFieldHelpPanel({
        trigger: {
          top: trigger.top,
          right: trigger.right,
          bottom: trigger.bottom,
          left: trigger.left,
          width: trigger.width,
          height: trigger.height,
        },
        panelSize: {
          width: measured.width || FIELD_HELP_PANEL_WIDTH_PX,
          height: measured.height || 200,
        },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        dir: readDocumentDir(document.documentElement.dir),
        bottomInset: measureBottomInset(),
      });
      setBox(next);
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => () => clearTimer(), []);

  return (
    <span className="field-help" ref={root}>
      <button
        ref={triggerRef}
        type="button"
        className="icon-btn field-help-trigger"
        aria-label={t("common.help", { title: props.title })}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="true"
        onClick={() => {
          clearTimer();
          skipFocusOpen.current = false;
          if (pinned) {
            setPinned(false);
            setOpen(false);
          } else {
            setPinned(true);
            setOpen(true);
          }
        }}
        onMouseEnter={openFromHover}
        onMouseLeave={closeFromHover}
        onFocus={() => {
          if (skipFocusOpen.current) {
            skipFocusOpen.current = false;
            return;
          }
          if (canHoverFine()) setOpen(true);
        }}
        onBlur={() => {
          if (!pinned) setOpen(false);
        }}
      >
        <IconInfo />
      </button>
      {open ? (
        <div
          ref={panelRef}
          className="field-help-panel"
          id={panelId}
          role="note"
          aria-label={props.title}
          data-inline-align={box?.inlineAlign ?? "start"}
          data-block-align={box?.blockAlign ?? "below"}
          style={
            box
              ? {
                  top: box.top,
                  left: box.left,
                  width: box.width,
                  maxHeight: box.maxHeight,
                  visibility: "visible",
                }
              : { top: 0, left: 0, visibility: "hidden" }
          }
          onMouseEnter={() => {
            if (canHoverFine()) {
              clearTimer();
              setOpen(true);
            }
          }}
          onMouseLeave={closeFromHover}
        >
          <strong>{props.title}</strong>
          <p>
            <span className="type-caption">{t("ui.fieldWhat")}</span>
            <br />
            {props.what}
          </p>
          <p>
            <span className="type-caption">{t("ui.fieldChoose")}</span>
            <br />
            {props.choose}
          </p>
          <p>
            <span className="type-caption">{t("ui.fieldExample")}</span>
            <br />
            {props.example}
          </p>
        </div>
      ) : null}
    </span>
  );
}
