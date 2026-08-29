import { HarnessError } from "../errors/index.ts";

export function parseDuration(duration: number | string): number {
  if (typeof duration === "number") {
    if (duration < 0 || !Number.isFinite(duration)) {
      throw new HarnessError("INVALID_ARGUMENT", "duration must be non-negative");
    }
    return duration;
  }
  if (typeof duration !== "string" || duration.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "duration string cannot be empty");
  }
  const match = duration.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i);
  if (!match) {
    throw new HarnessError("INVALID_ARGUMENT", `invalid duration format: ${duration}`);
  }
  const num = parseFloat(match[1]!);
  const rawUnit = match[2];
  const unit = rawUnit ? rawUnit.toLowerCase() : "ms";
  switch (unit) {
    case "s":
      return num * 1000;
    case "m":
      return num * 60 * 1000;
    case "h":
      return num * 60 * 60 * 1000;
    case "d":
      return num * 24 * 60 * 60 * 1000;
    default:
      return num;
  }
}

export function parseIntervalDuration(durationStr: string): number {
  if (typeof durationStr !== "string" || durationStr.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "duration string cannot be empty");
  }
  const trimmed = durationStr.trim().toLowerCase();
  if (
    trimmed === "0" ||
    trimmed === "0ms" ||
    trimmed === "0s" ||
    trimmed === "0m" ||
    trimmed === "0h" ||
    trimmed === "0d"
  ) {
    return 0;
  }
  return parseDuration(durationStr);
}

export function formatIntervalDuration(intervalMs: number): string {
  if (intervalMs <= 0) return "0ms";
  if (intervalMs < 1000) return `${intervalMs}ms`;

  const totalSeconds = Math.floor(intervalMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 && hours === 0) parts.push(`${seconds}s`);

  return parts.length > 0 ? parts.join(" ") : "0s";
}
