import { sep } from "node:path";
import { HarnessError } from "../../core/errors/harness-error.ts";

const PREFIXES = [".olt/capsules/", ".capsules/", "capsules/"] as const;

export function normalizeRunId(rawRunId: string): string {
  const trimmed = rawRunId.trim();
  let withoutPrefix = trimmed;
  for (const prefix of PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      withoutPrefix = trimmed.slice(prefix.length);
      break;
    }
  }
  if (withoutPrefix.length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "run_id must not be blank");
  }
  if (withoutPrefix.includes("/") || (sep !== "/" && withoutPrefix.includes(sep))) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `run_id must be an identifier, not a path: "${rawRunId}" still contains a path separator ` +
        `after stripping one optional capsules prefix`,
    );
  }
  return withoutPrefix;
}
