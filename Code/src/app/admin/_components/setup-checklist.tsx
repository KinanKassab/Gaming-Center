"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SetupStepId, SetupStepStatus } from "@/modules/onboarding/setup-types";
import { useT } from "@/i18n/provider";
import type { MessageKey } from "@/i18n/t";

const STORAGE_KEY = "gc-setup-checklist-dismissed";

const STEP_LABEL: Record<SetupStepId, MessageKey> = {
  branch: "onboarding.statusBranch",
  area: "onboarding.statusArea",
  deviceType: "onboarding.statusDeviceType",
  device: "onboarding.statusDevice",
  pricing: "onboarding.statusPricing",
  assignment: "onboarding.statusAssignment",
  payments: "onboarding.statusPayments",
  staff: "onboarding.statusStaff",
};

export function SetupChecklist(props: {
  steps: SetupStepStatus[];
  operationallyReady: boolean;
  wizardHref?: string;
}) {
  const t = useT();
  const [dismissed, setDismissed] = useState(false);
  const signature = props.steps.map((step) => `${step.id}:${step.done ? "1" : "0"}`).join("|");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    setDismissed(stored === signature);
  }, [signature]);

  const visibleSteps = props.steps.filter(
    (step) => step.id !== "assignment" && step.id !== "payments" && step.id !== "device",
  );

  if (props.operationallyReady) return null;
  const remaining = visibleSteps.filter((step) => !step.done);
  if (remaining.length === 0 || dismissed) return null;

  return (
    <section className="card">
      <div className="page-header">
        <div>
          <h2>{t("onboarding.continueTitle")}</h2>
          <p>{t("onboarding.continueBody")}</p>
        </div>
        <div className="page-header-actions">
          {props.wizardHref ? (
            <Link className="btn" href={props.wizardHref}>
              {t("onboarding.continueSetup")}
            </Link>
          ) : null}
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              window.localStorage.setItem(STORAGE_KEY, signature);
              setDismissed(true);
            }}
          >
            {t("onboarding.hideForNow")}
          </button>
        </div>
      </div>
      <div className="checklist">
        {visibleSteps.map((step) => (
          <Link key={step.id} href={step.href} className="checklist-item">
            <span>
              {t(STEP_LABEL[step.id])}
              {step.optional ? <span className="hint"> · {t("common.optional")}</span> : null}
            </span>
            <span className={step.done ? "badge badge-success" : "badge"}>
              {step.done ? t("common.ready") : t("common.needsSetup")}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
