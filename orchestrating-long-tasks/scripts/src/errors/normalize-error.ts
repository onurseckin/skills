import { HarnessError } from "./harness-error.ts";

export interface NormalizedError {
  code: string;
  message: string;
  issues: readonly unknown[];
  fix?: string;
  footer: string;
}

function footerFor(code: string): string {
  return `never read the harness source; run \`harness.ts help <command>\` or \`harness.ts explain ${code}\`.`;
}

export function normalizeError(error: unknown): NormalizedError {
  if (error instanceof HarnessError) {
    return {
      code: error.code,
      message: error.message,
      issues: error.issues,
      ...(error.fix === undefined ? {} : { fix: error.fix }),
      footer: footerFor(error.code),
    };
  }
  if (error instanceof Error) {
    return { code: "INTERNAL", message: error.message, issues: [], footer: footerFor("INTERNAL") };
  }
  return {
    code: "INTERNAL",
    message: "Unknown internal failure",
    issues: [],
    footer: footerFor("INTERNAL"),
  };
}
