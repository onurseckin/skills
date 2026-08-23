import type { IntegrityIssue } from "../../core/contracts/capsule.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";

export function issue(
  code: string,
  message: string,
  path?: string,
  subcode?: string,
): IntegrityIssue {
  const result: IntegrityIssue = { code, message };
  if (path !== undefined) {
    result.path = path;
  }
  if (subcode !== undefined) {
    result.subcode = subcode;
  }
  return result;
}

export function throwIntegrity(issues: readonly IntegrityIssue[]): never {
  throw new HarnessError("INTEGRITY", "run integrity verification failed", issues);
}
