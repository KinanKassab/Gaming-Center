"use client";

import { useEffect, useId, useRef } from "react";
import { Overlay, OverlayFooter } from "@/app/_components/overlay";
import { useT } from "@/i18n/provider";

export function ConfirmDialog(props: {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const titleId = useId();
  const bodyId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <Overlay
      kind="dialog"
      role="alertdialog"
      labelledBy={titleId}
      describedBy={bodyId}
      size="sm"
      onClose={props.onCancel}
      initialFocusRef={confirmRef}
    >
      <h2 id={titleId}>{props.title}</h2>
      <p id={bodyId}>{props.body}</p>
      <OverlayFooter>
        <button type="button" className="btn-secondary" onClick={props.onCancel}>
          {props.cancelLabel ?? t("common.cancel")}
        </button>
        <button
          ref={confirmRef}
          type="button"
          {...(props.danger ? { className: "btn-danger" } : {})}
          onClick={props.onConfirm}
        >
          {props.confirmLabel ?? t("common.confirm")}
        </button>
      </OverlayFooter>
    </Overlay>
  );
}
