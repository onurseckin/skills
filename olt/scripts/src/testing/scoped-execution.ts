/**
 * Strict Scoped Test Execution for Workers & Validators.
 * Target resolution, policy enforcement, command construction, and resource conservation auditing.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { HarnessError } from "../core/errors/index.ts";
import { isTestFilePath } from "./concurrency-lock.ts";
import { findRepoRoot } from "./isolation.ts";

export type TestFramework = "bun" | "vitest" | "jest" | "node" | "unknown";
export type TestRunnerType = "bun" | "npm" | "pnpm" | "yarn" | "vitest" | "jest";

export interface ScopedExecutionPolicy {
  readonly allowedDomains?: readonly string[] | undefined;
  readonly maxAllowedTestFiles?: number | undefined;
  readonly maxDurationMs?: number | undefined;
  readonly maxMemoryMb?: number | undefined;
  readonly maxCpuPercent?: number | undefined;
  readonly allowFullSuite?: boolean | undefined;
  readonly enforceLock?: boolean | undefined;
  readonly allowedRunners?: readonly TestRunnerType[] | undefined;
  readonly strictConfinement?: boolean | undefined;
}

export interface ScopedTestTarget {
  readonly rawPath: string;
  readonly normalizedPath: string;
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly domain: string;
  readonly testFramework: TestFramework;
  readonly exists: boolean;
  readonly isScoped: boolean;
  readonly fileSizeBytes?: number | undefined;
  readonly lineCount?: number | undefined;
}

export interface ExecutionBudgetMetrics {
  readonly durationMs: number;
  readonly memoryUsedMb: number;
  readonly cpuPercent: number;
  readonly memoryLimitMb: number;
  readonly cpuLimitPercent: number;
  readonly durationLimitMs: number;
  readonly conservedMemory: boolean;
  readonly conservedCpu: boolean;
  readonly conservedDuration: boolean;
  readonly withinBudget: boolean;
  readonly violations: readonly string[];
}

export interface ScopedExecutionAuditResult {
  readonly compliant: boolean;
  readonly policy: ScopedExecutionPolicy;
  readonly targets: readonly ScopedTestTarget[];
  readonly metrics?: ExecutionBudgetMetrics | undefined;
  readonly violations: readonly string[];
  readonly recommendedAction?: string | undefined;
  readonly timestamp: string;
}

export interface ResolveTargetsOptions {
  readonly cwd?: string | undefined;
  readonly repoRoot?: string | undefined;
  readonly allowedExtensions?: readonly string[] | undefined;
}

export interface BuildScopedTestCommandOptions {
  readonly runner?: TestRunnerType | undefined;
  readonly timeoutMs?: number | undefined;
  readonly filter?: string | undefined;
  readonly coverage?: boolean | undefined;
  readonly bail?: boolean | undefined;
  readonly extraArgs?: readonly string[] | undefined;
}

export interface ResourceUsageSample {
  readonly durationMs: number;
  readonly memoryUsedMb: number;
  readonly cpuPercent: number;
}

export interface ResourceBudgetLimits {
  readonly maxDurationMs?: number | undefined;
  readonly maxMemoryMb?: number | undefined;
  readonly maxCpuPercent?: number | undefined;
}

export interface ScopedExecutionAuditParams {
  readonly commandOrTargets: string | readonly string[] | readonly ScopedTestTarget[];
  readonly policy: ScopedExecutionPolicy;
  readonly resourceUsage?: ResourceUsageSample | undefined;
  readonly repoRoot?: string | undefined;
}

function extractTargetTokens(commandOrTargets: string | readonly string[]): string[] {
  if (typeof commandOrTargets !== "string") {
    return commandOrTargets.map((e) => e.trim()).filter((e) => e.length > 0 && !e.startsWith("-"));
  }
  const raw = commandOrTargets
    .trim()
    .split(/\s+/)
    .filter((e) => e.length > 0);
  if (raw.length === 0) return [];
  let rIdx = -1,
    aIdx = 0;
  for (let i = 0; i < raw.length; i++) {
    const base = basename(raw[i]!.toLowerCase());
    if (base === "bun" || base === "npm" || base === "pnpm" || base === "yarn") {
      const n1 = raw[i + 1]?.toLowerCase();
      if (n1 === "test" || n1 === "t") {
        rIdx = i;
        aIdx = i + 2;
        break;
      }
      if (
        n1 === "run" &&
        (raw[i + 2]?.toLowerCase() === "test" || raw[i + 2]?.toLowerCase() === "t")
      ) {
        rIdx = i;
        aIdx = i + 3;
        break;
      }
    } else if (base === "vitest" || base === "jest") {
      rIdx = i;
      aIdx = i + 1;
      break;
    }
  }
  const slice = rIdx !== -1 ? raw.slice(aIdx) : raw;
  const targets: string[] = [];
  let skip = false;
  const valFlags = new Set([
    "--timeout",
    "-t",
    "--filter",
    "-f",
    "--reporter",
    "-r",
    "--cwd",
    "--max-concurrency",
    "--threshold",
    "-u",
  ]);
  for (const token of slice) {
    if (skip) {
      skip = false;
      continue;
    }
    if (token === "--") continue;
    if (token.startsWith("-")) {
      if (valFlags.has(token)) skip = true;
      continue;
    }
    targets.push(token);
  }
  return targets;
}

function extractDomain(normalizedRelativePath: string): string {
  const parts = normalizedRelativePath.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return "default";
  if (parts[0] === "tests" || parts[0] === "test") return parts.length > 1 ? parts[1]! : "default";
  if (parts[0] === "src" || parts[0] === "lib" || parts[0] === "app")
    return parts.length > 1 ? parts[1]! : parts[0];
  return parts.length > 1 ? parts[0]! : "default";
}

function detectTestFramework(absPath: string, exists: boolean): TestFramework {
  if (!exists) return "bun";
  try {
    const c = readFileSync(absPath, "utf8");
    if (c.includes("bun:test")) return "bun";
    if (c.includes("vitest")) return "vitest";
    if (c.includes("jest")) return "jest";
    if (c.includes("node:test")) return "node";
  } catch {
    /* Non-fatal */
  }
  return "bun";
}

export function resolveScopedTestTargets(
  targets: readonly string[] | string,
  options?: ResolveTargetsOptions,
): ScopedTestTarget[] {
  const root = resolve(
    options?.repoRoot ?? (options?.cwd ? findRepoRoot(options.cwd) : findRepoRoot(process.cwd())),
  );
  return extractTargetTokens(targets).map((raw) => {
    const norm = raw.replace(/\\/g, "/");
    const absPath = isAbsolute(raw) ? resolve(raw) : resolve(root, raw);
    const relPath = relative(root, absPath).replace(/\\/g, "/");
    const exists = existsSync(absPath);
    let fileSizeBytes: number | undefined, lineCount: number | undefined;
    if (exists) {
      try {
        const stats = statSync(absPath);
        if (stats.isFile()) {
          fileSizeBytes = stats.size;
          lineCount = readFileSync(absPath, "utf8").split("\n").length;
        }
      } catch {
        /* Non-fatal */
      }
    }
    return {
      rawPath: raw,
      normalizedPath: norm,
      absolutePath: absPath,
      relativePath: relPath,
      domain: extractDomain(relPath),
      testFramework: detectTestFramework(absPath, exists),
      exists,
      isScoped: isTestFilePath(norm) || isTestFilePath(relPath),
      fileSizeBytes,
      lineCount,
    };
  });
}

export function assertScopedExecutionPolicy(
  targets: readonly (string | ScopedTestTarget)[],
  policy: ScopedExecutionPolicy,
  options?: { readonly repoRoot?: string | undefined },
): ScopedTestTarget[] {
  const resolved = targets.map((t) => {
    if (typeof t === "string") {
      const res = resolveScopedTestTargets([t], { repoRoot: options?.repoRoot });
      if (res.length === 0)
        throw new HarnessError(
          "INVALID_ARGUMENT",
          `Failed to parse target descriptor from string '${t}'`,
        );
      return res[0]!;
    }
    return t;
  });
  if (resolved.length === 0 && !policy.allowFullSuite) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "No test targets specified: policy strictly requires scoped single-file test execution.",
    );
  }
  if (policy.maxAllowedTestFiles !== undefined && resolved.length > policy.maxAllowedTestFiles) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Target count (${resolved.length}) exceeds maximum allowed test files of ${policy.maxAllowedTestFiles}`,
    );
  }
  for (const target of resolved) {
    if (!target.isScoped && !policy.allowFullSuite) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Target '${target.relativePath}' is not a scoped test file (broad execution is prohibited by policy)`,
      );
    }
    if (
      policy.allowedDomains &&
      policy.allowedDomains.length > 0 &&
      !policy.allowedDomains.includes(target.domain)
    ) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Domain '${target.domain}' for target '${target.relativePath}' is not permitted by policy. Allowed domains: ${policy.allowedDomains.join(", ")}`,
      );
    }
  }
  return resolved;
}

export function buildScopedTestCommand(
  targets: readonly (string | ScopedTestTarget)[],
  options: BuildScopedTestCommandOptions = {},
): string[] {
  if (targets.length === 0)
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Cannot build scoped test command without target paths",
    );
  const runner = options.runner ?? "bun";
  const valid: readonly TestRunnerType[] = ["bun", "npm", "pnpm", "yarn", "vitest", "jest"];
  if (!valid.includes(runner))
    throw new HarnessError("INVALID_ARGUMENT", `Unsupported test runner: ${String(runner)}`);
  const paths = targets.map((t) => (typeof t === "string" ? t.trim() : t.relativePath));
  const cmd: string[] = [];
  if (runner === "bun") cmd.push("bun", "test", ...paths);
  else if (runner === "npm") cmd.push("npm", "test", "--", ...paths);
  else if (runner === "pnpm") cmd.push("pnpm", "test", "--", ...paths);
  else if (runner === "yarn") cmd.push("yarn", "test", ...paths);
  else if (runner === "vitest") cmd.push("vitest", "run", ...paths);
  else if (runner === "jest") cmd.push("jest", ...paths);

  if (options.timeoutMs !== undefined && options.timeoutMs > 0)
    cmd.push("--timeout", String(options.timeoutMs));
  if (options.filter !== undefined && options.filter.trim().length > 0) {
    cmd.push(runner === "vitest" || runner === "jest" ? "-t" : "--filter", options.filter.trim());
  }
  if (options.coverage) cmd.push("--coverage");
  if (options.bail) cmd.push("--bail");
  if (options.extraArgs && options.extraArgs.length > 0) cmd.push(...options.extraArgs);
  return cmd;
}

export function validateMemoryAndCpuConservation(
  usage: ResourceUsageSample,
  limits: ResourceBudgetLimits = {},
): ExecutionBudgetMetrics {
  const durationLimitMs = Math.max(100, limits.maxDurationMs ?? 60_000);
  const memoryLimitMb = Math.max(16, limits.maxMemoryMb ?? 512);
  const cpuLimitPercent = Math.max(1, limits.maxCpuPercent ?? 100);
  const conservedMemory = usage.memoryUsedMb <= memoryLimitMb;
  const conservedCpu = usage.cpuPercent <= cpuLimitPercent;
  const conservedDuration = usage.durationMs <= durationLimitMs;
  const withinBudget = conservedMemory && conservedCpu && conservedDuration;
  const violations: string[] = [];
  if (!conservedMemory)
    violations.push(
      `Memory limit exceeded: observed ${usage.memoryUsedMb.toFixed(1)}MB > limit ${memoryLimitMb}MB`,
    );
  if (!conservedCpu)
    violations.push(
      `CPU ceiling exceeded: observed ${usage.cpuPercent.toFixed(1)}% > limit ${cpuLimitPercent}%`,
    );
  if (!conservedDuration)
    violations.push(
      `Duration budget exceeded: observed ${usage.durationMs}ms > limit ${durationLimitMs}ms`,
    );
  return {
    durationMs: usage.durationMs,
    memoryUsedMb: usage.memoryUsedMb,
    cpuPercent: usage.cpuPercent,
    memoryLimitMb,
    cpuLimitPercent,
    durationLimitMs,
    conservedMemory,
    conservedCpu,
    conservedDuration,
    withinBudget,
    violations,
  };
}

export function auditScopedExecutionCompliance(
  params: ScopedExecutionAuditParams,
): ScopedExecutionAuditResult {
  const targets =
    Array.isArray(params.commandOrTargets) &&
    params.commandOrTargets.length > 0 &&
    typeof params.commandOrTargets[0] === "object"
      ? (params.commandOrTargets as readonly ScopedTestTarget[])
      : resolveScopedTestTargets(params.commandOrTargets as string | readonly string[], {
          repoRoot: params.repoRoot,
        });
  const violations: string[] = [];
  if (targets.length === 0 && !params.policy.allowFullSuite) {
    violations.push("No test targets specified: policy strictly requires scoped test execution.");
  }
  if (
    params.policy.maxAllowedTestFiles !== undefined &&
    targets.length > params.policy.maxAllowedTestFiles
  ) {
    violations.push(
      `Target count (${targets.length}) exceeds maximum allowed test files of ${params.policy.maxAllowedTestFiles}`,
    );
  }
  for (const t of targets) {
    if (!t.isScoped && !params.policy.allowFullSuite)
      violations.push(
        `Target '${t.relativePath}' is an unscoped broad target (forbidden by policy)`,
      );
    if (
      params.policy.allowedDomains &&
      params.policy.allowedDomains.length > 0 &&
      !params.policy.allowedDomains.includes(t.domain)
    ) {
      violations.push(
        `Target domain '${t.domain}' (${t.relativePath}) is not in allowed domains: ${params.policy.allowedDomains.join(", ")}`,
      );
    }
  }
  let metrics: ExecutionBudgetMetrics | undefined;
  if (params.resourceUsage) {
    metrics = validateMemoryAndCpuConservation(params.resourceUsage, {
      maxDurationMs: params.policy.maxDurationMs,
      maxMemoryMb: params.policy.maxMemoryMb,
      maxCpuPercent: params.policy.maxCpuPercent,
    });
    if (!metrics.withinBudget) violations.push(...metrics.violations);
  }
  const compliant = violations.length === 0;
  return {
    compliant,
    policy: params.policy,
    targets,
    metrics,
    violations,
    recommendedAction: compliant
      ? "Execution conforms to scoped execution policy."
      : "Scope execution to designated test files and enforce resource conservation limits.",
    timestamp: new Date().toISOString(),
  };
}
