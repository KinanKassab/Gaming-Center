"use client";

import { useId, useState, type ReactNode } from "react";
import { Dialog, OverlayHeader } from "@/app/_components/overlay";

export function StaffEditTrigger(props: {
  title: string;
  editLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  return (
    <>
      <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(true)}>
        {props.editLabel}
      </button>
      {open ? (
        <Dialog labelledBy={titleId} onClose={() => setOpen(false)} size="md">
          <OverlayHeader titleId={titleId} title={props.title} onClose={() => setOpen(false)} />
          <div className="stack stack-wide">{props.children}</div>
        </Dialog>
      ) : null}
    </>
  );
}
