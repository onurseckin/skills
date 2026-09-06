#!/usr/bin/env bun

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HarnessError } from "./src/core/errors/harness-error.ts";
import { execute } from "./src/cli/execute.ts";
import { helpRequest, renderHelp } from "./src/cli/help.ts";
import { stripOutputFormat } from "./src/cli/output-format.ts";
import {
  extractOrchestrateInlinePrompt,
  shouldAutoReadOrchestrateStdin,
  shouldReadPromptStdin,
} from "./src/cli/prompt-input.ts";
import { formatCliError, propagateCliExitCode, setupSignalTraps } from "./src/cli/signals/index.ts";
import { PolicyDiscoveryEngine } from "./src/engine/policy-discovery.ts";
import { findRepoRoot } from "./src/core/shared/paths.ts";

const loggedErrors = new WeakSet<object>();

export function mapCategoryFromErrorCode(code: string): string {
  switch (code) {
    case "INVALID_STATE":
    case "LOCK_TIMEOUT":
    case "INTEGRITY":
      return "state_conflict";
    case "PERMISSION_DENIED":
    case "AUTHENTICATION_FAILURE":
    case "ROLE_CONFINEMENT_VIOLATION":
    case "ROLE_BOUNDARY_DEVIATION":
    case "PATH_SAFETY":
      return "permission_denied";
    default:
      return "cli_error";
  }
}

export function mapSeverityFromErrorCode(code: string): "important" | "critical" {
  switch (code) {
    case "AUTHENTICATION_FAILURE":
    case "PERMISSION_DENIED":
    case "ROLE_CONFINEMENT_VIOLATION":
    case "ROLE_BOUNDARY_DEVIATION":
    case "INTEGRITY":
    case "UNHANDLED_ERROR":
      return "critical";
    default:
      return "important";
  }
}

export function extractErrorCode(error: unknown): string {
  if (error instanceof HarnessError) {
    return error.code;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { readonly code: unknown }).code === "string"
  ) {
    return (error as { readonly code: string }).code;
  }
  return "UNHANDLED_ERROR";
}

export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { readonly message: unknown }).message === "string"
  ) {
    return (error as { readonly message: string }).message;
  }
  return String(error);
}

export function logCliDefect(error: unknown, argv: readonly string[]): void {
  try {
    if (typeof error === "object" && error !== null) {
      if (loggedErrors.has(error)) {
        return;
      }
      loggedErrors.add(error);
    }
    const repoRoot = findRepoRoot();
    const oltDir = join(repoRoot, ".olt");
    if (!existsSync(oltDir)) {
      mkdirSync(oltDir, { recursive: true });
    }
    const defectsPath = join(oltDir, "defects.jsonl");
    const errorCode = extractErrorCode(error);
    const errorMessage = extractErrorMessage(error);
    const record = {
      id: `defect-cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      category: mapCategoryFromErrorCode(errorCode),
      command: argv.join(" "),
      error_code: errorCode,
      message: errorMessage,
      severity: mapSeverityFromErrorCode(errorCode),
      status: "open",
    };
    appendFileSync(defectsPath, `${JSON.stringify(record)}\n`, "utf-8");
  } catch {
    // Non-blocking: defect logging failures must never interfere with CLI behavior
  }
}

async function stdinBytes(maximum = 64 * 1024 * 1024): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const value of process.stdin) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    total += chunk.byteLength;
    if (total > maximum) throw new HarnessError("INVALID_ARGUMENT", "stdin exceeds size limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

export async function main(argv: readonly string[]): Promise<void> {
  try {
    try {
      const repoRoot = findRepoRoot();
      PolicyDiscoveryEngine.ensurePolicyCalibrated(repoRoot);
    } catch {
      // Ignore when invoked outside a sovereign repository root
    }

    const executingRuntime = fileURLToPath(new URL(".", import.meta.url));
    const format = stripOutputFormat(argv);
    const help = helpRequest(format.argv);
    if (help !== null) {
      process.stdout.write(
        `${renderHelp(help.command, help.internal !== undefined ? { internal: help.internal } : undefined)}\n`,
      );
      return;
    }
    const { argv: execArgv, inlinePrompt } = extractOrchestrateInlinePrompt(format.argv);
    const readStdin =
      inlinePrompt === undefined &&
      (shouldReadPromptStdin(execArgv) ||
        shouldAutoReadOrchestrateStdin(format.argv, process.stdin.isTTY === true));
    const context = {
      executingRuntime,
      ...(inlinePrompt === undefined ? {} : { inlinePrompt }),
      ...(readStdin ? { stdin: await stdinBytes() } : {}),
    };
    const result = await execute(execArgv, context);
    const isJsonOutput =
      format.json ||
      (typeof result === "object" && result !== null && "json" in result && result.json === true);
    if (
      !isJsonOutput &&
      typeof result === "object" &&
      result !== null &&
      "markdown" in result &&
      typeof result.markdown === "string"
    ) {
      process.stdout.write(`${result.markdown}\n`);
    } else {
      process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
    }
  } catch (error: unknown) {
    logCliDefect(error, argv);
    throw error;
  }
}

if (import.meta.main) {
  setupSignalTraps();
  const argv = Bun.argv.slice(2);
  main(argv).catch((error: unknown) => {
    logCliDefect(error, argv);
    const isJson = stripOutputFormat(argv).json;
    process.stderr.write(formatCliError(error, { json: isJson }));
    propagateCliExitCode(error);
  });
}
