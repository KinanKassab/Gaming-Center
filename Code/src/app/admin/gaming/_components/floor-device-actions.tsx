"use client";

import { useId, useRef, useState } from "react";
import { ActionButton, ApiForm } from "@/app/admin/_components/controls";
import { apiErrorText, apiRequest } from "@/app/admin/_components/api";
import { FormField } from "@/app/_components/form-field";
import { ConfirmDialog } from "@/app/_components/confirm-dialog";
import { Overlay, OverlayFooter } from "@/app/_components/overlay";
import { useLocale, useT } from "@/i18n/provider";
import type { FloorDevice } from "@/modules/gaming";
import { endedSessionCheckoutHref } from "@/ui/session-checkout";
import {
  FLOOR_START_API_METHOD,
  FLOOR_START_API_PATH,
  FLOOR_START_NATIVE_ACTION,
  FLOOR_START_NATIVE_METHOD,
} from "@/ui/floor-start-form-safety";
import { useRouter } from "next/navigation";

export function FloorDeviceActions(props: {
  tile: FloorDevice;
  canStart: boolean;
  canOperate: boolean;
  canCancel: boolean;
  customers: Array<{ id: string; displayName: string }>;
  moveTargets: Array<{ id: string; code: string; name: string }>;
  startNativeAction?: string;
}) {
  const t = useT();
  const { tile } = props;
  const session = tile.session?.session;
  const sessionId = session?.id;

  if (tile.occupancy === "AVAILABLE" && props.canStart) {
    return (
      <div className="floor-tile-ops">
        <ApiForm
          action={FLOOR_START_API_PATH}
          method={FLOOR_START_API_METHOD}
          nativeAction={props.startNativeAction ?? FLOOR_START_NATIVE_ACTION}
          nativeMethod={FLOOR_START_NATIVE_METHOD}
          javascriptRequiredMessage={t("floor.javascriptRequired")}
          submitLabel={t("floor.start")}
          extraBody={{ deviceId: tile.deviceId }}
          fields={
            props.customers.length > 0
              ? [
                  {
                    name: "customerId",
                    label: t("floor.customer"),
                    type: "select",
                    optional: true,
                    options: props.customers.map((customer) => ({
                      value: customer.id,
                      label: customer.displayName,
                    })),
                  },
                ]
              : []
          }
        />
      </div>
    );
  }

  if (!sessionId || !props.canOperate) {
    return null;
  }

  return (
    <div className="floor-tile-ops">
      <div className="floor-tile-primary">
        <div className="floor-tile-actions">
          {session?.status === "ACTIVE" ? (
            <ActionButton action={`/api/gaming/sessions/${sessionId}/pause`} method="POST" label={t("floor.pause")} />
          ) : null}
          {session?.status === "PAUSED" ? (
            <ActionButton action={`/api/gaming/sessions/${sessionId}/resume`} method="POST" label={t("floor.resume")} />
          ) : null}
          <EndSessionControl sessionId={sessionId} />
        </div>
        {props.moveTargets.length > 0 ? (
          <ApiForm
            action={`/api/gaming/sessions/${sessionId}/move`}
            submitLabel={t("floor.move")}
            fields={[
              {
                name: "deviceId",
                label: t("floor.moveTo"),
                type: "select",
                options: props.moveTargets.map((device) => ({
                  value: device.id,
                  label: device.name,
                })),
              },
            ]}
          />
        ) : null}
      </div>
      {!session?.customerId && props.customers.length > 0 ? (
        <ApiForm
          action={`/api/gaming/sessions/${sessionId}/customer`}
          submitLabel={t("floor.assignCustomer")}
          fields={[
            {
              name: "customerId",
              label: t("floor.customer"),
              type: "select",
              options: props.customers.map((customer) => ({
                value: customer.id,
                label: customer.displayName,
              })),
            },
          ]}
        />
      ) : null}
      {props.canCancel ? <CancelSessionControl sessionId={sessionId} /> : null}
    </div>
  );
}

function EndSessionControl(props: { sessionId: string }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  function close() {
    if (busy) return;
    setOpen(false);
  }

  async function runEnd() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const result = await apiRequest(`/api/gaming/sessions/${props.sessionId}/end`, { method: "POST" });
    if (result.ok) {
      const href = endedSessionCheckoutHref(result.body, props.sessionId);
      if (href) {
        router.push(href);
        return;
      }
      inFlight.current = false;
      setBusy(false);
      router.refresh();
      return;
    }
    inFlight.current = false;
    setBusy(false);
    setError(apiErrorText(result, locale));
  }

  return (
    <span className="action">
      <button type="button" className="btn-sm" disabled={busy} onClick={() => setOpen(true)}>
        {busy ? "…" : t("floor.end")}
      </button>
      {error ? <span className="error"> {error}</span> : null}
      {open ? (
        <ConfirmDialog
          title={t("floor.end")}
          body={t("floor.endConfirm")}
          confirmLabel={t("floor.confirmEnd")}
          cancelLabel={t("floor.keepSession")}
          onCancel={close}
          onConfirm={() => {
            setOpen(false);
            void runEnd();
          }}
        />
      ) : null}
    </span>
  );
}

function CancelSessionControl(props: { sessionId: string }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const titleId = useId();
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  function close() {
    if (busy) return;
    setOpen(false);
    setError(null);
    setReason("");
  }

  async function confirm() {
    const trimmed = reason.trim();
    if (!trimmed || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const result = await apiRequest(`/api/gaming/sessions/${props.sessionId}/cancel`, {
      method: "POST",
      body: { reason: trimmed },
    });
    inFlight.current = false;
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      setReason("");
      router.refresh();
      return;
    }
    setError(apiErrorText(result, locale));
  }

  return (
    <div className="floor-tile-secondary">
      <button type="button" className="btn-ghost floor-cancel-trigger" onClick={() => setOpen(true)}>
        {t("floor.cancel")}
      </button>
      {open ? (
        <Overlay kind="dialog" role="alertdialog" labelledBy={titleId} size="sm" onClose={close}>
          <h2 id={titleId}>{t("floor.cancel")}</h2>
          <p>{t("sessions.cancelHint")}</p>
          <FormField htmlFor={reasonId} label={t("sessions.reason")} {...(error ? { error } : {})}>
            <textarea
              id={reasonId}
              name="reason"
              rows={3}
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </FormField>
          <OverlayFooter>
            <button type="button" className="btn-secondary" onClick={close} disabled={busy}>
              {t("floor.keepSession")}
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={busy || reason.trim().length === 0}
              onClick={() => void confirm()}
            >
              {busy ? t("common.working") : t("sessions.cancelSubmit")}
            </button>
          </OverlayFooter>
        </Overlay>
      ) : null}
    </div>
  );
}
