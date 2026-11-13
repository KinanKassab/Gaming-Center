import type { SetupStepId, SetupStepStatus } from "./setup-types";

/**
 * Wizard UI steps. Welcome / Finish have no row in setup status.
 * Requirement flags come from `getGamingCenterSetupStatus` (real tenant rows).
 * Assignment and payments stay internal readiness flags, not stepper items.
 */
export const WIZARD_STEP_IDS = [
  "welcome",
  "branch",
  "area",
  "deviceType",
  "pricing",
  "customers",
  "products",
  "staff",
  "roles",
  "review",
] as const;

export type WizardStepId = (typeof WIZARD_STEP_IDS)[number];

const MULTI_ENTRY_STEPS = new Set<WizardStepId>([
  "area",
  "deviceType",
  "pricing",
  "customers",
  "products",
  "staff",
  "roles",
]);

/** Setup-status rows that must be done before this UI step can advance. */
const WIZARD_READY_FLAGS: Partial<Record<WizardStepId, readonly SetupStepId[]>> = {
  branch: ["branch"],
  area: ["area"],
  deviceType: ["deviceType", "device"],
  pricing: ["pricing", "assignment"],
  staff: ["staff"],
};

export function isWizardStepId(value: string): value is WizardStepId {
  return (WIZARD_STEP_IDS as readonly string[]).includes(value);
}

export function isMultiEntryWizardStep(stepId: WizardStepId): boolean {
  return MULTI_ENTRY_STEPS.has(stepId);
}

/** Only the first branch form auto-advances after a successful create. */
export function shouldAutoAdvanceWizardForm(stepId: WizardStepId): boolean {
  return stepId === "branch";
}

export function wizardStatusId(stepId: WizardStepId): SetupStepId | null {
  const flags = WIZARD_READY_FLAGS[stepId];
  return flags?.[0] ?? null;
}

export function wizardStepStatus(
  stepId: WizardStepId,
  steps: SetupStepStatus[],
): SetupStepStatus | undefined {
  const flags = WIZARD_READY_FLAGS[stepId];
  if (!flags || flags.length === 0) return undefined;
  const parts = flags
    .map((id) => steps.find((step) => step.id === id))
    .filter((step): step is SetupStepStatus => Boolean(step));
  const primary = parts[0];
  if (!primary) return undefined;
  return {
    ...primary,
    done: parts.every((step) => step.done),
  };
}

export function canAdvanceWizard(index: number, steps: SetupStepStatus[]): boolean {
  if (index < 0 || index >= WIZARD_STEP_IDS.length - 1) return false;
  const stepId = WIZARD_STEP_IDS[index]!;
  const status = wizardStepStatus(stepId, steps);
  if (!status) return true;
  if (status.optional) return true;
  return status.done;
}

export function canSkipWizardStep(index: number, steps: SetupStepStatus[]): boolean {
  if (index < 0 || index >= WIZARD_STEP_IDS.length - 1) return false;
  const stepId = WIZARD_STEP_IDS[index]!;
  const status = wizardStepStatus(stepId, steps);
  return status?.optional === true;
}

/**
 * Clickable steps: earlier required data must already exist.
 * Optional steps (staff) do not block later steps.
 */
export function canOpenWizardStep(targetIndex: number, steps: SetupStepStatus[]): boolean {
  if (targetIndex < 0 || targetIndex >= WIZARD_STEP_IDS.length) return false;
  for (let i = 0; i < targetIndex; i += 1) {
    const stepId = WIZARD_STEP_IDS[i]!;
    const status = wizardStepStatus(stepId, steps);
    if (!status) continue;
    if (!status.optional && !status.done) return false;
  }
  return true;
}

export function initialWizardIndex(steps: SetupStepStatus[], operationallyReady: boolean): number {
  if (operationallyReady) {
    const review = WIZARD_STEP_IDS.indexOf("review");
    return review === -1 ? 0 : review;
  }
  const firstIncomplete = WIZARD_STEP_IDS.findIndex((stepId) => {
    const status = wizardStepStatus(stepId, steps);
    return status ? !status.done : false;
  });
  if (firstIncomplete <= 1) return 0;
  return firstIncomplete;
}

export type WizardReviewItem = {
  id: "branch" | "area" | "devices" | "pricing" | "staff";
  done: boolean;
  optional: boolean;
};

export function wizardReviewItems(steps: SetupStepStatus[]): WizardReviewItem[] {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const type = byId.get("deviceType");
  const device = byId.get("device");
  const pricing = byId.get("pricing");
  const assignment = byId.get("assignment");
  const staff = byId.get("staff");
  return [
    {
      id: "branch",
      done: byId.get("branch")?.done ?? false,
      optional: false,
    },
    {
      id: "area",
      done: byId.get("area")?.done ?? false,
      optional: false,
    },
    {
      id: "devices",
      done: Boolean(type?.done && device?.done),
      optional: false,
    },
    {
      id: "pricing",
      done: Boolean(pricing?.done && assignment?.done),
      optional: false,
    },
    {
      id: "staff",
      done: staff?.done ?? false,
      optional: staff?.optional ?? true,
    },
  ];
}
