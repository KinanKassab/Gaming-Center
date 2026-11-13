"use client";

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useT } from "@/i18n/provider";

export type ToastTone = "info" | "success" | "warning" | "danger";

export type ToastInput = {
  title: string;
  body?: string;
  tone?: ToastTone;
};

type ToastItem = ToastInput & { id: string; tone: ToastTone };

type ToastApi = {
  show: (input: ToastInput) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider(props: { children: ReactNode }) {
  const t = useT();
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const show = useCallback((input: ToastInput) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tone = input.tone ?? "info";
    const item: ToastItem = { id, title: input.title, tone };
    if (input.body) item.body = input.body;
    setToasts((current) => [...current, item]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4200);
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {props.children}
      <div
        className="toast-region"
        aria-live="polite"
        aria-relevant="additions text"
        aria-label={t("ui.notifications")}
      >
        {toasts.map((toast) => (
          <div key={toast.id} className="toast" data-tone={toast.tone} role="status">
            <strong>{toast.title}</strong>
            {toast.body ? <p>{toast.body}</p> : null}
            <button type="button" className="btn-ghost btn-sm" onClick={() => setToasts((c) => c.filter((row) => row.id !== toast.id))}>
              {t("common.dismiss")}
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) {
    return { show: () => undefined };
  }
  return value;
}

export function LoadingState(props: { label?: string }) {
  const t = useT();
  return (
    <div className="loading-state" role="status" aria-live="polite">
      {props.label ?? t("ui.loadingLabel")}
    </div>
  );
}

export function ErrorState(props: { title?: string; body?: string }) {
  const t = useT();
  return (
    <div className="error-state" role="alert">
      <h2>{props.title ?? t("common.error")}</h2>
      {props.body ? <p>{props.body}</p> : null}
    </div>
  );
}

export function SuccessBanner(props: { title?: string; body?: string }) {
  const t = useT();
  return (
    <div className="success-banner" role="status">
      <strong>{props.title ?? t("common.success")}</strong>
      {props.body ? <p>{props.body}</p> : null}
    </div>
  );
}

export function Skeleton(props: { lines?: number; label?: string }) {
  const t = useT();
  const count = props.lines ?? 3;
  const labelId = useId();
  return (
    <div className="loading-state" role="status" aria-labelledby={labelId}>
      <span id={labelId} className="sr-only">
        {props.label ?? t("ui.loadingLabel")}
      </span>
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="skeleton" style={{ margin: "0.45rem 0" }} />
      ))}
    </div>
  );
}
