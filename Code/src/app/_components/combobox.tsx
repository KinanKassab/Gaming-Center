"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { IconClose } from "@/app/_components/icons";
import { useT } from "@/i18n/provider";

export type ComboboxOption = { value: string; label: string };

export function Combobox(props: {
  options: ComboboxOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  id?: string;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  labelledBy?: string;
}) {
  const t = useT();
  const listId = useId();
  const inputId = props.id ?? listId;
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const selected = props.options.find((option) => option.value === props.value) ?? null;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle || (selected && query === selected.label)) return props.options;
    return props.options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [props.options, query, selected]);

  useEffect(() => {
    if (selected && !open) setQuery(selected.label);
    if (!selected && !open) setQuery("");
  }, [selected, open]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  function commit(option: ComboboxOption | null) {
    props.onChange(option ? option.value : null);
    setQuery(option ? option.label : "");
    setOpen(false);
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Home" && open) {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End" && open) {
      event.preventDefault();
      setActive(Math.max(filtered.length - 1, 0));
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      const option = filtered[active];
      if (option) commit(option);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  const activeOption = filtered[active];

  return (
    <div className="combobox" ref={root}>
      {props.name ? <input type="hidden" name={props.name} value={props.value ?? ""} /> : null}
      <div className="combobox-control">
        <input
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          {...(props.labelledBy ? { "aria-labelledby": props.labelledBy } : {})}
          {...(activeOption && open ? { "aria-activedescendant": `${listId}-${activeOption.value}` } : {})}
          disabled={props.disabled}
          placeholder={props.placeholder ?? t("common.search")}
          value={query}
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(0);
            if (event.target.value === "") props.onChange(null);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
        />
        {props.value ? (
          <button
            type="button"
            className="icon-btn"
            aria-label={t("common.clear")}
            disabled={props.disabled}
            onClick={() => commit(null)}
          >
            <IconClose />
          </button>
        ) : (
          <span />
        )}
      </div>
      {open ? (
        <ul className="combobox-list" role="listbox" id={listId}>
          {filtered.length === 0 ? (
            <li className="empty-state">{t("ui.comboboxEmpty")}</li>
          ) : (
            filtered.map((option, index) => (
              <li key={option.value} role="presentation">
                <button
                  type="button"
                  id={`${listId}-${option.value}`}
                  role="option"
                  className="combobox-option"
                  aria-selected={props.value === option.value}
                  data-active={index === active ? "true" : "false"}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => commit(option)}
                >
                  {option.label}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
