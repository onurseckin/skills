import type { IntegrityIssue } from "../contracts/capsule.ts";
import { HarnessError } from "../errors/harness-error.ts";

export function issue(code: string, message: string, path?: string): IntegrityIssue {
  return path === undefined ? { code, message } : { code, message, path };
}

export function throwIntegrity(issues: readonly IntegrityIssue[]): never {
  throw new HarnessError("INTEGRITY", "run integrity verification failed", issues);
}
