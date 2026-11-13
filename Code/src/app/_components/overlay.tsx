"use client";

import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useT } from "@/i18n/provider";
import { IconClose } from "@/app/_components/icons";

export type OverlayKind = "dialog" | "modal" | "drawer" | "sheet" | "bottom-sheet";
export type OverlaySize = "sm" | "md" | "lg" | "xl";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

let scrollLocks = 0;

function lockScroll() {
  scrollLocks += 1;
  if (scrollLocks === 1) {
    document.body.dataset.gcOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
}

function unlockScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) {
    document.body.style.overflow = document.body.dataset.gcOverflow ?? "";
    delete document.body.dataset.gcOverflow;
  }
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => !node.hasAttribute("disabled") && node.getAttribute("aria-hidden") !== "true",
  );
}

export function Overlay(props: {
  kind: OverlayKind;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
  describedBy?: string;
  size?: OverlaySize;
  closeOnScrim?: boolean;
  closeOnEscape?: boolean;
  adaptive?: boolean;
  role?: "dialog" | "alertdialog";
  initialFocusRef?: { current: HTMLElement | null };
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;
  const closeOnEscape = props.closeOnEscape !== false;
  const closeOnScrim = props.closeOnScrim !== false;
  const adaptive = props.adaptive !== false;
  const size = props.size ?? (props.kind === "dialog" ? "sm" : "md");
  const role = props.role ?? "dialog";

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lockScroll();
    const panel = panelRef.current;
    const target = props.initialFocusRef?.current ?? focusables(panel ?? document.body)[0];
    target?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && closeOnEscape) {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const nodes = focusables(panelRef.current);
      if (nodes.length === 0) {
        event.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      unlockScroll();
      previousFocus.current?.focus();
    };
  }, [closeOnEscape, props.initialFocusRef]);

  function onScrimClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!closeOnScrim) return;
    if (event.target === event.currentTarget) onCloseRef.current();
  }

  const describedBy = props.describedBy;

  const tree = (
    <div
      className="overlay-scrim"
      data-kind={props.kind === "drawer" ? "drawer" : props.kind === "bottom-sheet" ? "bottom-sheet" : "dialog"}
      role="presentation"
      onClick={onScrimClick}
    >
      <div
        ref={panelRef}
        className="overlay-panel"
        data-kind={props.kind}
        data-size={size}
        data-adaptive={adaptive ? "true" : "false"}
        role={role}
        aria-modal="true"
        aria-labelledby={props.labelledBy}
        {...(describedBy ? { "aria-describedby": describedBy } : {})}
        onClick={(event) => event.stopPropagation()}
      >
        {props.children}
      </div>
    </div>
  );

  if (typeof document === "undefined") return tree;
  return createPortal(tree, document.body);
}

export function OverlayHeader(props: { titleId: string; title: string; onClose?: () => void }) {
  const t = useT();
  return (
    <div className="overlay-header">
      <h2 id={props.titleId}>{props.title}</h2>
      {props.onClose ? (
        <button type="button" className="icon-btn" aria-label={t("ui.overlayClose")} onClick={props.onClose}>
          <IconClose />
        </button>
      ) : null}
    </div>
  );
}

export function OverlayFooter(props: { children: ReactNode }) {
  return <div className="overlay-footer">{props.children}</div>;
}

export function Dialog(props: Omit<Parameters<typeof Overlay>[0], "kind">) {
  return <Overlay kind="dialog" {...props} />;
}

export function Modal(props: Omit<Parameters<typeof Overlay>[0], "kind">) {
  return <Overlay kind="modal" {...props} />;
}

export function Drawer(props: Omit<Parameters<typeof Overlay>[0], "kind">) {
  return <Overlay kind="drawer" {...props} />;
}

export function Sheet(props: Omit<Parameters<typeof Overlay>[0], "kind">) {
  return <Overlay kind="sheet" {...props} />;
}

export function BottomSheet(props: Omit<Parameters<typeof Overlay>[0], "kind">) {
  return <Overlay kind="bottom-sheet" {...props} />;
}

export function trapTab(event: ReactKeyboardEvent<HTMLElement>, root: HTMLElement | null) {
  if (event.key !== "Tab" || !root) return;
  const nodes = focusables(root);
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
