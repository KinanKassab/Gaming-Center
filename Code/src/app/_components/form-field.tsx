"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";
import { FieldHelp } from "@/app/_components/field-help";
import { useT } from "@/i18n/provider";
import { joinDescribedBy } from "@/ui/accessible-name";

type FieldControlProps = {
  id?: string;
  describedBy?: string;
  "aria-describedby"?: string;
  labelledBy?: string;
};

function enhanceControl(child: ReactNode, extra: { id: string } & { describedBy?: string }): ReactNode {
  if (!isValidElement(child)) return child;
  const existing = child.props as FieldControlProps;
  const describedBy = joinDescribedBy(existing.describedBy, existing["aria-describedby"], extra.describedBy);
  const id = existing.id ?? extra.id;
  const native = child.type === "input" || child.type === "select" || child.type === "textarea";
  if (native) {
    return cloneElement(child as ReactElement<Record<string, unknown>>, {
      id,
      ...(describedBy ? { "aria-describedby": describedBy } : {}),
    });
  }
  return cloneElement(child as ReactElement<FieldControlProps>, {
    id,
    ...(describedBy ? { describedBy } : {}),
  });
}

export function FormField(props: {
  label: string;
  children: ReactNode;
  htmlFor?: string;
  optional?: boolean;
  help?: { title: string; what: string; choose: string; example: string };
  helper?: string;
  error?: string;
}) {
  const t = useT();
  const generatedId = useId();
  const labelId = useId();
  const helperId = useId();
  const errorId = useId();
  const controlId = props.htmlFor ?? generatedId;
  const help = props.help;
  const helperText = props.helper && !props.error ? props.helper : null;
  const describedBy = joinDescribedBy(helperText ? helperId : null, props.error ? errorId : null);

  return (
    <div className="form-field">
      <div className="form-field-label-row">
        <label htmlFor={controlId} id={labelId}>
          {props.label}
          {props.optional ? (
            <>
              {" "}
              <span className="form-field-optional">({t("common.optional")})</span>
            </>
          ) : null}
        </label>
        {help ? <FieldHelp title={help.title} what={help.what} choose={help.choose} example={help.example} /> : null}
      </div>
      {Children.map(props.children, (child) =>
        enhanceControl(child, describedBy ? { id: controlId, describedBy } : { id: controlId }),
      )}
      {helperText ? (
        <span className="hint" id={helperId}>
          {helperText}
        </span>
      ) : null}
      {props.error ? (
        <span className="form-field-error" id={errorId} role="alert">
          {props.error}
        </span>
      ) : null}
    </div>
  );
}
