import { HarnessError } from "./harness-error.ts";

export interface NormalizedError {
  code: string;
  message: string;
  issues: readonly unknown[];
}

export function normalizeError(error: unknown): NormalizedError {
  if (error instanceof HarnessError) {
    return { code: error.code, message: error.message, issues: error.issues };
  }
  if (error instanceof Error) {
    return { code: "INTERNAL", message: error.message, issues: [] };
  }
  return { code: "INTERNAL", message: "Unknown internal failure", issues: [] };
}
