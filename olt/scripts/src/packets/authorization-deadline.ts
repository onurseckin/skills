import { HarnessError } from "../core/errors/harness-error.ts";

export function assertActiveCriticDeadline(value: unknown, now: number): void {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new HarnessError("INTEGRITY", "completeness critic deadline is invalid");
  if (Date.parse(value) <= now)
    throw new HarnessError("INVALID_STATE", "completeness critic authorization expired");
}
