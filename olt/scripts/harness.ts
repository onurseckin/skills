#!/usr/bin/env bun

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
import { findRepoRoot, resolveSkillHomeRepo } from "./src/core/shared/paths.ts";
import { bootstrapTelemetryQuota } from "./src/orchestrator/lifecycle/index.ts";

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

export interface DefectRoutingResolution {
  readonly skillHomeRepo: string;
  readonly globalSkillDir: string;
  readonly dualWriteEnabled: boolean;
}

function expandTilde(filepath: string): string {
  if (filepath === "~" || filepath.startsWith("~/")) return join(homedir(), filepath.slice(1));
  return filepath;
}

function readJsonObj(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const p = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return typeof p === "object" && p !== null ? (p as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export function resolveDefectRouting(repoRoot: string): DefectRoutingResolution {
  const policyCandidates = [
    join(repoRoot, ".olt", "policy.json"),
    join(repoRoot, "olt", "policy.json"),
  ];
  const polObj = policyCandidates
    .map(readJsonObj)
    .find((p) => p && typeof p.defect_routing === "object");
  const pol = polObj?.defect_routing as Record<string, unknown> | undefined;
  const cfg = readJsonObj(join(homedir(), ".agents", "skills", "olt", "skill-config.json"));
  const cfgR =
    cfg && typeof cfg.defect_routing === "object"
      ? (cfg.defect_routing as Record<string, unknown>)
      : undefined;

  const homeVal =
    process.env["OLT_SKILL_HOME_REPO"]?.trim() ||
    (typeof pol?.skill_home_repo_root === "string" ? pol.skill_home_repo_root.trim() : undefined) ||
    (typeof cfgR?.skill_home_repo_root === "string" ? cfgR.skill_home_repo_root.trim() : undefined);
  let skillHomeRepo: string;
  if (homeVal) {
    skillHomeRepo = resolve(expandTilde(homeVal));
  } else {
    try {
      skillHomeRepo = resolveSkillHomeRepo();
    } catch {
      skillHomeRepo = "/Users/onurseckinsenoglu/repos/skills";
    }
  }

  const globalVal =
    process.env["OLT_GLOBAL_SKILL_DIR"]?.trim() ||
    (typeof pol?.global_skill_dir === "string" ? pol.global_skill_dir.trim() : undefined) ||
    (typeof cfgR?.global_skill_dir === "string" ? cfgR.global_skill_dir.trim() : undefined);
  const globalSkillDir = resolve(
    expandTilde(globalVal || join(homedir(), ".agents", "skills", "olt")),
  );

  const envDual = process.env["OLT_DUAL_WRITE"]?.trim().toLowerCase();
  const dualWriteEnabled =
    envDual === "false" || envDual === "0"
      ? false
      : typeof pol?.dual_write_enabled === "boolean"
        ? pol.dual_write_enabled
        : typeof cfgR?.dual_write_enabled === "boolean"
          ? cfgR.dual_write_enabled
          : true;

  return { skillHomeRepo, globalSkillDir, dualWriteEnabled };
}

export function logCliDefect(error: unknown, argv: readonly string[]): void {
  try {
    if (typeof error === "object" && error !== null) {
      if (loggedErrors.has(error)) return;
      loggedErrors.add(error);
    }
    const repoRoot = findRepoRoot();
    const errorCode = extractErrorCode(error);
    const record = {
      id: `defect-cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      category: mapCategoryFromErrorCode(errorCode),
      command: argv.join(" "),
      error_code: errorCode,
      message: extractErrorMessage(error),
      severity: mapSeverityFromErrorCode(errorCode),
      status: "open",
      source_repo: repoRoot,
    };
    const line = `${JSON.stringify(record)}\n`;
    const localDefectsPath = join(repoRoot, ".olt", "defects.jsonl");

    const writeSafe = (target: string): void => {
      try {
        const d = dirname(target);
        if (!existsSync(d)) mkdirSync(d, { recursive: true });
        appendFileSync(target, line, "utf-8");
      } catch {}
    };

    writeSafe(localDefectsPath);

    const { skillHomeRepo, globalSkillDir, dualWriteEnabled } = resolveDefectRouting(repoRoot);
    if (dualWriteEnabled) {
      const localResolved = resolve(localDefectsPath);
      const targets = new Set<string>();
      const homeTarget = resolve(join(skillHomeRepo, ".olt", "defects.jsonl"));
      const globalTarget = resolve(join(globalSkillDir, ".olt", "defects.jsonl"));
      if (homeTarget !== localResolved) targets.add(homeTarget);
      if (globalTarget !== localResolved) targets.add(globalTarget);
      for (const t of targets) writeSafe(t);
    }
  } catch {}
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
  bootstrapTelemetryQuota();
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
