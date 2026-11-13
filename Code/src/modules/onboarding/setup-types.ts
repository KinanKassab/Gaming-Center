/**
 * Shared setup-status shapes. Keep this file free of database imports so
 * client wizard components never pull the status query module into Webpack.
 */
export type SetupStepId =
  | "branch"
  | "area"
  | "deviceType"
  | "device"
  | "pricing"
  | "assignment"
  | "payments"
  | "staff";

export type SetupStepStatus = {
  id: SetupStepId;
  label: string;
  done: boolean;
  optional: boolean;
  href: string;
};
