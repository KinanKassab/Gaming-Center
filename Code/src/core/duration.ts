import { ValidationError } from "@/core/errors";

export type DurationParts = {
  hours: number;
  minutes: number;
  seconds: number;
};

export function durationToSeconds(hours: number, minutes: number, seconds = 0): number {
  if (![hours, minutes, seconds].every((value) => Number.isInteger(value) && value >= 0)) {
    throw new ValidationError("Duration parts must be non-negative integers");
  }
  return hours * 3600 + minutes * 60 + seconds;
}

export function secondsToDuration(totalSeconds: number): DurationParts {
  if (!Number.isInteger(totalSeconds) || totalSeconds < 0) {
    throw new ValidationError("Duration must be a non-negative whole number of seconds");
  }
  return {
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

export function formatDurationSeconds(totalSeconds: number): string {
  const { hours, minutes, seconds } = secondsToDuration(totalSeconds);
  const parts: string[] = [];
  if (hours > 0) parts.push(hours === 1 ? "1 hour" : `${hours} hours`);
  if (minutes > 0) parts.push(minutes === 1 ? "1 minute" : `${minutes} minutes`);
  if (seconds > 0) parts.push(seconds === 1 ? "1 second" : `${seconds} seconds`);
  return parts.length > 0 ? parts.join(" ") : "0 minutes";
}

/** Compact unit noun for “price per …” copy. */
export function billingUnitPhrase(totalSeconds: number): string {
  if (totalSeconds === 3600) return "hour";
  if (totalSeconds === 1800) return "30 minutes";
  if (totalSeconds === 60) return "minute";
  if (totalSeconds > 0 && totalSeconds % 3600 === 0) {
    const hours = totalSeconds / 3600;
    return hours === 1 ? "hour" : `${hours} hours`;
  }
  if (totalSeconds > 0 && totalSeconds % 60 === 0) {
    const minutes = totalSeconds / 60;
    return minutes === 1 ? "minute" : `${minutes} minutes`;
  }
  return formatDurationSeconds(totalSeconds);
}
