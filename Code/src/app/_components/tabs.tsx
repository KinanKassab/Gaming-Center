"use client";

import { useId, type KeyboardEvent, type ReactNode } from "react";

export type TabItem = {
  id: string;
  label: string;
  panel?: ReactNode;
};

export function Pills(props: {
  items: Array<{ id: string; label: string }>;
  value: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="ui-pills" role="tablist" {...(props.ariaLabel ? { "aria-label": props.ariaLabel } : {})}>
      {props.items.map((item) => {
        const selected = item.id === props.value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            className={`ui-pill${selected ? " active" : ""}`}
            aria-selected={selected}
            onClick={() => props.onChange(item.id)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function Tabs(props: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
}) {
  const baseId = useId();

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    const index = props.items.findIndex((item) => item.id === props.value);
    if (index < 0) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const rtl = document.documentElement.dir === "rtl";
      const visual = event.key === "ArrowRight" ? 1 : -1;
      const dir = rtl ? -visual : visual;
      const next = props.items[(index + dir + props.items.length) % props.items.length];
      if (next) props.onChange(next.id);
    }
  }

  const selected = props.items.find((item) => item.id === props.value) ?? props.items[0];

  return (
    <div>
      <div
        className="ui-tabs"
        role="tablist"
        {...(props.ariaLabel ? { "aria-label": props.ariaLabel } : {})}
        onKeyDown={onKey}
      >
        {props.items.map((item) => {
          const isSelected = item.id === selected?.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              className="ui-tab"
              id={`${baseId}-${item.id}`}
              aria-selected={isSelected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => props.onChange(item.id)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {selected?.panel ? (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${selected.id}`}
          aria-labelledby={`${baseId}-${selected.id}`}
        >
          {selected.panel}
        </div>
      ) : null}
    </div>
  );
}
