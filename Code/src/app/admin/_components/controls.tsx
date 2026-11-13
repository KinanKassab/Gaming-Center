"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { apiErrorText, apiRequest } from "@/app/admin/_components/api";
import { resolveSelectActionUrl } from "@/app/admin/_lib/select-action";
import { FormField } from "@/app/_components/form-field";
import { ConfirmDialog } from "@/app/_components/confirm-dialog";
import { useT, useLocale } from "@/i18n/provider";
import {
  BETTER_AUTH_SIGN_OUT_PATH,
  betterAuthSignOutInit,
  isSuccessfulSignOutResponse,
} from "@/auth/sign-out-http";
import { IconSignOut } from "@/app/_components/icons";
import { permissionDescriptionText, permissionLabel, permissionModuleLabel } from "@/app/_lib/display";
import {
  allPermissionCodes,
  groupPermissionCatalog,
  permissionGroupFullySelected,
  togglePermissionGroup,
  type PermissionCatalogItem,
} from "@/ui/permission-catalog";

export type ApiFormField = {
  name: string;
  label: string;
  type?: "text" | "password" | "email" | "number" | "textarea" | "select";
  optional?: boolean;
  /** When set, an empty optional field is sent as JSON null instead of omitted. */
  emptyAsNull?: boolean;
  placeholder?: string;
  defaultValue?: string;
  options?: Array<{ value: string; label: string }>;
};

/** Small JSON form: collects named fields, submits, surfaces server errors. */
export function ApiForm(props: {
  action: string;
  method?: "POST" | "PATCH" | "PUT";
  /**
   * Native HTML action. Defaults to POST against the JSON `action` URL, which
   * fail-closes (JSON APIs reject form-urlencoded). Floor Start must pass the
   * Floor page so a degraded submit never GET-navigates.
   */
  nativeAction?: string;
  nativeMethod?: "post";
  fields: ApiFormField[];
  submitLabel: string;
  extraBody?: Record<string, unknown>;
  javascriptRequiredMessage?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const formId = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const nativeMethod = props.nativeMethod ?? "post";
  const nativeAction = props.nativeAction ?? props.action;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    const form = event.currentTarget;
    const data = new FormData(form);
    const body: Record<string, unknown> = { ...props.extraBody };
    for (const field of props.fields) {
      const raw = (data.get(field.name) as string | null)?.trim() ?? "";
      if (raw === "" && field.optional) {
        if (field.emptyAsNull) body[field.name] = null;
        continue;
      }
      body[field.name] = raw;
    }
    setBusy(true);
    setError(null);
    const result = await apiRequest(props.action, { method: props.method ?? "POST", body });
    inFlight.current = false;
    setBusy(false);
    if (result.ok) {
      form.reset();
      router.refresh();
    } else {
      setError(apiErrorText(result, locale));
    }
  }

  return (
    <form className="stack" method={nativeMethod} action={nativeAction} onSubmit={onSubmit}>
      {props.javascriptRequiredMessage ? (
        <noscript>
          <p className="error">{props.javascriptRequiredMessage}</p>
        </noscript>
      ) : null}
      {props.fields.map((field) => {
        const controlId = `${formId}-${field.name}`;
        const control =
          field.type === "textarea" ? (
            <textarea
              id={controlId}
              name={field.name}
              {...(field.placeholder ? { placeholder: field.placeholder } : {})}
              {...(field.defaultValue ? { defaultValue: field.defaultValue } : {})}
              required={!field.optional}
              rows={3}
            />
          ) : field.type === "select" ? (
            <select
              id={controlId}
              name={field.name}
              defaultValue={field.defaultValue ?? ""}
              required={!field.optional}
            >
              {field.optional ? <option value="">—</option> : null}
              {(field.options ?? []).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={controlId}
              name={field.name}
              type={field.type ?? "text"}
              {...(field.placeholder ? { placeholder: field.placeholder } : {})}
              {...(field.defaultValue ? { defaultValue: field.defaultValue } : {})}
              required={!field.optional}
            />
          );
        return (
          <FormField
            key={field.name}
            label={field.label}
            htmlFor={controlId}
            {...(field.optional ? { optional: true } : {})}
          >
            {control}
          </FormField>
        );
      })}
      <button type="submit" formMethod={nativeMethod} formAction={nativeAction} disabled={busy}>
        {busy ? t("common.working") : props.submitLabel}
      </button>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}

/** One-click mutation (suspend, archive, revoke, select organization, …). */
export function ActionButton(props: {
  action: string;
  method?: "POST" | "PUT" | "PATCH" | "DELETE";
  body?: Record<string, unknown>;
  label: string;
  confirmText?: string;
  danger?: boolean;
  /** When set, success navigates here instead of refresh. Return null to stay. */
  successHrefFromBody?: (body: unknown) => string | null;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const inFlight = useRef(false);

  async function run() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const result = await apiRequest(props.action, {
      method: props.method ?? "POST",
      body: props.body,
    });
    if (result.ok) {
      const href = props.successHrefFromBody?.(result.body) ?? null;
      if (href) {
        inFlight.current = false;
        setBusy(false);
        router.push(href);
        return;
      }
      inFlight.current = false;
      setBusy(false);
      router.refresh();
    } else {
      inFlight.current = false;
      setBusy(false);
      setError(apiErrorText(result, locale));
    }
  }

  return (
    <span className="action">
      <button
        type="button"
        className={props.danger ? "btn-danger btn-sm" : "btn-sm"}
        onClick={() => {
          if (props.confirmText) setConfirming(true);
          else void run();
        }}
        disabled={busy}
      >
        {busy ? "…" : props.label}
      </button>
      {error ? <span className="error"> {error}</span> : null}
      {confirming ? (
        <ConfirmDialog
          title={props.label}
          body={props.confirmText ?? t("common.areYouSure")}
          danger={props.danger ?? /archive|cancel|remove|delete/i.test(props.label)}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void run();
          }}
        />
      ) : null}
    </span>
  );
}

/** Pick an option, then apply it via PUT (assign role / grant branch access). */
export function SelectAction(props: {
  options: Array<{ value: string; label: string }>;
  /** Static URL with exactly one `{value}` placeholder. Must be serializable. */
  actionTemplate: string;
  method?: "PUT" | "POST";
  body?: Record<string, unknown>;
  submitLabel: string;
}) {
  const locale = useLocale();
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onApply() {
    if (!value) return;
    setBusy(true);
    setError(null);
    const result = await apiRequest(resolveSelectActionUrl(props.actionTemplate, value), {
      method: props.method ?? "PUT",
      body: props.body,
    });
    setBusy(false);
    if (result.ok) {
      setValue("");
      router.refresh();
    } else {
      setError(apiErrorText(result, locale));
    }
  }

  return (
    <span className="action">
      <select value={value} onChange={(event) => setValue(event.target.value)}>
        <option value="">—</option>
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button type="button" onClick={onApply} disabled={busy || !value}>
        {busy ? "…" : props.submitLabel}
      </button>
      {error ? <span className="error"> {error}</span> : null}
    </span>
  );
}

/** Checkbox editor that replaces a role's permission set. */
export function RolePermissionsEditor(props: {
  roleId: string;
  catalog: PermissionCatalogItem[];
  assigned: string[];
  disabled?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set(props.assigned));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const groups = groupPermissionCatalog(props.catalog);
  const catalogCodes = allPermissionCodes(props.catalog);

  function toggle(code: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  }

  async function onSave() {
    setBusy(true);
    setError(null);
    const result = await apiRequest(`/api/roles/${props.roleId}/permissions`, {
      method: "PUT",
      body: { permissionCodes: [...selected] },
    });
    setBusy(false);
    if (result.ok) {
      router.refresh();
    } else {
      setError(apiErrorText(result, locale));
    }
  }

  return (
    <div className="stack">
      {props.disabled ? null : (
        <div className="permission-toolbar">
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setSelected(new Set(catalogCodes))}
          >
            {t("roles.selectAll")}
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={() => setSelected(new Set())}>
            {t("roles.deselectAll")}
          </button>
        </div>
      )}
      {groups.map((group) => {
        const groupCodes = group.permissions.map((permission) => permission.code);
        const groupSelected = permissionGroupFullySelected(selected, groupCodes);
        return (
          <section key={group.module} className="permission-module">
            <div className="permission-module-header">
              <h3>{permissionModuleLabel(group.module, locale)}</h3>
              {props.disabled ? null : (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => setSelected(togglePermissionGroup(selected, groupCodes))}
                >
                  {groupSelected ? t("roles.deselectGroup") : t("roles.selectGroup")}
                </button>
              )}
            </div>
            <div className="permission-grid">
              {group.permissions.map((permission) => {
                const description = permissionDescriptionText(
                  permission.code,
                  locale,
                  permission.description,
                );
                return (
                  <div key={permission.code} className="permission-item">
                    <label className="inline">
                      <input
                        type="checkbox"
                        checked={selected.has(permission.code)}
                        onChange={() => toggle(permission.code)}
                        disabled={props.disabled}
                      />
                      {permissionLabel(permission.code, locale, permission.name)}
                    </label>
                    {description ? <p className="hint">{description}</p> : null}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      {props.disabled ? null : (
        <button type="button" onClick={onSave} disabled={busy}>
          {busy ? t("common.saving") : t("roles.savePermissions")}
        </button>
      )}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

/** Sign out via Better Auth, then return to the login page. */
export function SignOutButton(props: { variant?: "full" | "icon" }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const icon = props.variant === "icon";

  async function onClick() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(BETTER_AUTH_SIGN_OUT_PATH, betterAuthSignOutInit());
      if (!isSuccessfulSignOutResponse(response)) {
        setError(t("common.signOutFailed"));
        setBusy(false);
        return;
      }
      window.location.replace("/login");
    } catch {
      setError(t("common.signOutFailed"));
      setBusy(false);
    }
  }

  return (
    <span className="sign-out-control">
      <button
        type="button"
        className={icon ? "icon-btn" : "btn-secondary btn-sm"}
        onClick={onClick}
        disabled={busy}
        {...(icon ? { "aria-label": t("common.signOut") } : {})}
      >
        {busy ? "…" : icon ? <IconSignOut /> : t("common.signOut")}
      </button>
      {error ? (
        <span className="error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
