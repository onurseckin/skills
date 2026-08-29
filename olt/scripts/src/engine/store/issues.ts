import type { IntegrityIssue } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";

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
