import { sep } from "node:path";
import { HarnessError } from "../../errors/harness-error.ts";

const CAPSULES_PREFIX = ".capsules/";

export function normalizeRunId(rawRunId: string): string {
  const trimmed = rawRunId.trim();
  const withoutPrefix = trimmed.startsWith(CAPSULES_PREFIX)
    ? trimmed.slice(CAPSULES_PREFIX.length)
    : trimmed;
  if (withoutPrefix.length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "run_id must not be blank");
  }
  if (withoutPrefix.includes("/") || (sep !== "/" && withoutPrefix.includes(sep))) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `run_id must be an identifier, not a path: "${rawRunId}" still contains a path separator ` +
        `after stripping one optional "${CAPSULES_PREFIX}" prefix`,
    );
  }
  return withoutPrefix;
}
