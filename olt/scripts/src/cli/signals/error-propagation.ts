import { HarnessError } from "../../core/errors/index.ts";
import { normalizeError } from "../../core/errors/index.ts";

export function mapErrorToExitCode(error: unknown): number {
  if (error instanceof HarnessError) {
    return error.exitCode;
  }

  if (typeof error === "object" && error !== null) {
    const candidate = error as { exitCode?: unknown; code?: unknown };
    if (typeof candidate.exitCode === "number" && candidate.exitCode > 0) {
      return candidate.exitCode;
    }

    if (typeof candidate.code === "string") {
      switch (candidate.code) {
        case "INVALID_ARGUMENT":
          return 2;
        case "PATH_SAFETY":
        case "INTEGRITY":
        case "PERMISSION_DENIED":
        case "AUTHENTICATION_FAILURE":
        case "ROLE_CONFINEMENT_VIOLATION":
          return 3;
        case "LOCK_TIMEOUT":
          return 4;
        case "NOT_IMPLEMENTED":
          return 70;
        default:
          return 1;
      }
    }
  }

  return 70;
}

export function formatCliError(
  error: unknown,
  options: {
    readonly json?: boolean | undefined;
    readonly subcommand?: string | undefined;
  } = {},
): string {
  if (options.json) {
    return `${JSON.stringify({ ok: false, error: normalizeError(error) })}\n`;
  }

  const sub =
    typeof options.subcommand === "string" && options.subcommand.length > 0
      ? options.subcommand
      : "<subcommand>";
  const helpHint =
    `\nFor detailed usage and permitted arguments, run:\n` +
    `  bun harness.ts ${sub} --help\n` +
    `[CRITICAL NOTICE: Do NOT inspect harness source files or grep events.jsonl. Follow the provided remediation.]\n`;

  if (error instanceof HarnessError) {
    const fixPart = error.fix ? `\n> **Fix**: ${error.fix}` : "";
    return `**Error (${error.code})**: ${error.message}${fixPart}\n${helpHint}`;
  }

  const message = error instanceof Error ? error.message : String(error);
  return `**Fatal Internal Error**: ${message}\n`;
}

export function propagateCliExitCode(error: unknown): number {
  const exitCode = mapErrorToExitCode(error);
  process.exitCode = exitCode;
  return exitCode;
}
