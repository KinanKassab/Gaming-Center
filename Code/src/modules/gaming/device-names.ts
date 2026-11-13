import { ValidationError } from "@/core/errors";
import { BULK_DEVICE_MAX_COUNT } from "./device-names-limit";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function padSequence(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function requireDeviceName(value: string): string {
  const name = value.trim();
  if (name.length < 1) throw new ValidationError("Device name is required");
  if (name.length > 200) throw new ValidationError("Device name must be at most 200 characters");
  return name;
}

export function previewBulkDeviceNames(input: {
  deviceTypeName: string;
  namePrefix?: string | null;
  count: number;
  existingNames?: string[];
}): string[] {
  if (!Number.isInteger(input.count) || input.count < 1) {
    throw new ValidationError("Create at least one device");
  }
  if (input.count > BULK_DEVICE_MAX_COUNT) {
    throw new ValidationError(`Create at most ${BULK_DEVICE_MAX_COUNT} devices at once`);
  }
  const base = (input.namePrefix?.trim() || input.deviceTypeName).trim();
  if (base.length < 1) throw new ValidationError("Device name is required");
  const pattern = new RegExp(`^${escapeRegExp(base)} - (\\d+)$`);
  let max = 0;
  for (const name of input.existingNames ?? []) {
    const match = pattern.exec(name);
    if (match) {
      const n = Number(match[1]);
      if (Number.isInteger(n) && n > max) max = n;
    }
  }
  const last = max + input.count;
  const width = Math.max(2, String(last).length);
  const names: string[] = [];
  for (let index = 1; index <= input.count; index += 1) {
    names.push(requireDeviceName(`${base} - ${padSequence(max + index, width)}`));
  }
  return names;
}
