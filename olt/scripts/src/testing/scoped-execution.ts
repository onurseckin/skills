/**
 * Strict Scoped Test Execution for Workers & Validators.
 *
 * Implements fine-grained test target resolution, policy enforcement, command construction,
 * resource conservation (RAM & CPU budget validation), and compliance auditing
 * to prevent full test suite thrashing and out-of-memory cascades during parallel worker execution.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { HarnessError } from "../core/errors/harness-error.ts";
import { findRepoRoot } from "./isolation.ts";
import { isTestFilePath } from "./concurrency-lock.ts";

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

/**
 * Tokenizes a command string or token list into positional target candidates,
 * stripping runner flags and options.
 */
function extractTargetTokens(commandOrTargets: string | readonly string[]): string[] {
  if (typeof commandOrTargets !== "string") {
    return commandOrTargets
      .map((entry: string) => entry.trim())
      .filter((entry: string) => entry.length > 0 && !entry.startsWith("-"));
  }

  const rawTokens = commandOrTargets
    .trim()
    .split(/\s+/)
    .filter((entry: string) => entry.length > 0);
  if (rawTokens.length === 0) return [];

  let testRunnerIndex = -1;
  let argsStartIndex = 0;

  for (let i = 0; i < rawTokens.length; i++) {
    const token = rawTokens[i]!.toLowerCase();
    const base = basename(token);

    if (base === "bun" || base === "npm" || base === "pnpm" || base === "yarn") {
      const next = rawTokens[i + 1]?.toLowerCase();
      if (next === "test" || next === "t") {
        testRunnerIndex = i;
        argsStartIndex = i + 2;
        break;
      }
      if (next === "run") {
        const afterRun = rawTokens[i + 2]?.toLowerCase();
        if (afterRun === "test" || afterRun === "t") {
          testRunnerIndex = i;
          argsStartIndex = i + 3;
          break;
        }
      }
    } else if (base === "vitest" || base === "jest") {
      testRunnerIndex = i;
      argsStartIndex = i + 1;
      break;
    }
  }

  const tokensToProcess = testRunnerIndex !== -1 ? rawTokens.slice(argsStartIndex) : rawTokens;
  const targets: string[] = [];
  let skipNext = false;

  for (let i = 0; i < tokensToProcess.length; i++) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    const token = tokensToProcess[i]!;
    if (token === "--") {
      continue;
    }

    if (token.startsWith("-")) {
      if (
        token === "--timeout" ||
        token === "-t" ||
        token === "--filter" ||
        token === "-f" ||
        token === "--reporter" ||
        token === "-r" ||
        token === "--cwd" ||
        token === "--max-concurrency" ||
        token === "--threshold" ||
        token === "-u"
      ) {
        skipNext = true;
      }
      continue;
    }

    targets.push(token);
  }

  return targets;
}

/**
 * Extracts the domain classification from a test target relative path.
 * Examples:
 * - tests/unit/testing/scoped.test.ts -> "unit"
 * - tests/integration/api.test.ts -> "integration"
 * - src/components/button.test.tsx -> "components"
 */
function extractDomain(normalizedRelativePath: string): string {
  const parts = normalizedRelativePath.split("/").filter((part) => part.length > 0);
  if (parts.length === 0) return "default";

  if (parts[0] === "tests" || parts[0] === "test") {
    return parts.length > 1 ? parts[1]! : "default";
  }

  if (parts[0] === "src" || parts[0] === "lib" || parts[0] === "app") {
    return parts.length > 1 ? parts[1]! : parts[0];
  }

  return parts.length > 1 ? parts[0]! : "default";
}

/**
 * Inspects a file's content to detect the specific test framework being utilized.
 */
function detectTestFramework(absolutePath: string, exists: boolean): TestFramework {
  if (!exists) return "bun";

  try {
    const content = readFileSync(absolutePath, "utf8");
    if (content.includes("bun:test")) return "bun";
    if (content.includes("vitest")) return "vitest";
    if (content.includes("jest")) return "jest";
    if (content.includes("node:test")) return "node";
  } catch {
    // Non-fatal, fall through to default
  }

  return "bun";
}

/**
 * Resolves raw test target paths or command strings into structured ScopedTestTarget descriptors.
 */
export function resolveScopedTestTargets(
  targets: readonly string[] | string,
  options?: ResolveTargetsOptions,
): ScopedTestTarget[] {
  let rootPath: string;
  if (options !== undefined && options.repoRoot !== undefined) {
    rootPath = options.repoRoot;
  } else {
    const cwdPath =
      options !== undefined && options.cwd !== undefined ? options.cwd : process.cwd();
    rootPath = findRepoRoot(cwdPath);
  }
  const root = resolve(rootPath);
  const rawTokens = extractTargetTokens(targets);

  return rawTokens.map((raw) => {
    const normalizedRaw = raw.replace(/\\/g, "/");
    const absPath = isAbsolute(raw) ? resolve(raw) : resolve(root, raw);
    const relPath = relative(root, absPath).replace(/\\/g, "/");
    const exists = existsSync(absPath);
    const isScoped = isTestFilePath(normalizedRaw) || isTestFilePath(relPath);
    const domain = extractDomain(relPath);
    const framework = detectTestFramework(absPath, exists);

    let fileSizeBytes: number | undefined;
    let lineCount: number | undefined;

    if (exists) {
      try {
        const stats = statSync(absPath);
        if (stats.isFile()) {
          fileSizeBytes = stats.size;
          const content = readFileSync(absPath, "utf8");
          lineCount = content.split("\n").length;
        }
      } catch {
        // Non-fatal
      }
    }

    return {
      rawPath: raw,
      normalizedPath: normalizedRaw,
      absolutePath: absPath,
      relativePath: relPath,
      domain,
      testFramework: framework,
      exists,
      isScoped,
      fileSizeBytes,
      lineCount,
    };
  });
}

/**
 * Asserts that the provided test targets conform strictly to the specified ScopedExecutionPolicy.
 * Throws a HarnessError if any policy requirement is violated.
 */
export function assertScopedExecutionPolicy(
  targets: readonly (string | ScopedTestTarget)[],
  policy: ScopedExecutionPolicy,
  options?: { readonly repoRoot?: string | undefined },
): ScopedTestTarget[] {
  const resolvedTargets: ScopedTestTarget[] = targets.map((target) => {
    if (typeof target === "string") {
      const resolved = resolveScopedTestTargets([target], { repoRoot: options?.repoRoot });
      if (resolved.length === 0) {
        throw new HarnessError(
          "INVALID_ARGUMENT",
          `Failed to parse target descriptor from string '${target}'`,
        );
      }
      return resolved[0]!;
    }
    return target;
  });

  if (resolvedTargets.length === 0 && !policy.allowFullSuite) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "No test targets specified: policy strictly requires scoped single-file test execution.",
    );
  }

  if (
    policy.maxAllowedTestFiles !== undefined &&
    resolvedTargets.length > policy.maxAllowedTestFiles
  ) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Target count (${resolvedTargets.length}) exceeds maximum allowed test files of ${policy.maxAllowedTestFiles}`,
    );
  }

  for (const target of resolvedTargets) {
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

  return resolvedTargets;
}

/**
 * Builds a deterministic, scoped CLI command array for running the targeted tests.
 */
export function buildScopedTestCommand(
  targets: readonly (string | ScopedTestTarget)[],
  options: BuildScopedTestCommandOptions = {},
): string[] {
  if (targets.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Cannot build scoped test command without target paths",
    );
  }

  const runner: TestRunnerType = options.runner !== undefined ? options.runner : "bun";
  const validRunners: readonly TestRunnerType[] = ["bun", "npm", "pnpm", "yarn", "vitest", "jest"];
  if (!validRunners.includes(runner)) {
    throw new HarnessError("INVALID_ARGUMENT", `Unsupported test runner: ${String(runner)}`);
  }

  const targetPaths = targets.map((t) => (typeof t === "string" ? t.trim() : t.relativePath));

  const commandTokens: string[] = [];

  switch (runner) {
    case "bun":
      commandTokens.push("bun", "test", ...targetPaths);
      break;
    case "npm":
      commandTokens.push("npm", "test", "--", ...targetPaths);
      break;
    case "pnpm":
      commandTokens.push("pnpm", "test", "--", ...targetPaths);
      break;
    case "yarn":
      commandTokens.push("yarn", "test", ...targetPaths);
      break;
    case "vitest":
      commandTokens.push("vitest", "run", ...targetPaths);
      break;
    case "jest":
      commandTokens.push("jest", ...targetPaths);
      break;
  }

  if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
    commandTokens.push("--timeout", String(options.timeoutMs));
  }

  if (options.filter !== undefined && options.filter.trim().length > 0) {
    if (runner === "vitest" || runner === "jest") {
      commandTokens.push("-t", options.filter.trim());
    } else {
      commandTokens.push("--filter", options.filter.trim());
    }
  }

  if (options.coverage) {
    commandTokens.push("--coverage");
  }

  if (options.bail) {
    commandTokens.push("--bail");
  }

  if (options.extraArgs && options.extraArgs.length > 0) {
    commandTokens.push(...options.extraArgs);
  }

  return commandTokens;
}

/**
 * Validates whether the measured memory and CPU usage during test execution
 * adhered to conservation limits.
 */
export function validateMemoryAndCpuConservation(
  usage: ResourceUsageSample,
  limits: ResourceBudgetLimits = {},
): ExecutionBudgetMetrics {
  const maxDuration = limits.maxDurationMs !== undefined ? limits.maxDurationMs : 60_000;
  const durationLimitMs = Math.max(100, maxDuration);
  const maxMemory = limits.maxMemoryMb !== undefined ? limits.maxMemoryMb : 512;
  const memoryLimitMb = Math.max(16, maxMemory);
  const maxCpu = limits.maxCpuPercent !== undefined ? limits.maxCpuPercent : 100;
  const cpuLimitPercent = Math.max(1, maxCpu);

  const conservedMemory = usage.memoryUsedMb <= memoryLimitMb;
  const conservedCpu = usage.cpuPercent <= cpuLimitPercent;
  const conservedDuration = usage.durationMs <= durationLimitMs;
  const withinBudget = conservedMemory && conservedCpu && conservedDuration;

  const violations: string[] = [];

  if (!conservedMemory) {
    violations.push(
      `Memory limit exceeded: observed ${usage.memoryUsedMb.toFixed(1)}MB > limit ${memoryLimitMb}MB`,
    );
  }

  if (!conservedCpu) {
    violations.push(
      `CPU ceiling exceeded: observed ${usage.cpuPercent.toFixed(1)}% > limit ${cpuLimitPercent}%`,
    );
  }

  if (!conservedDuration) {
    violations.push(
      `Duration budget exceeded: observed ${usage.durationMs}ms > limit ${durationLimitMs}ms`,
    );
  }

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

/**
 * Audits test command invocation or target set for complete policy and budget compliance.
 */
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

  for (const target of targets) {
    if (!target.isScoped && !params.policy.allowFullSuite) {
      violations.push(
        `Target '${target.relativePath}' is an unscoped broad target (forbidden by policy)`,
      );
    }

    if (
      params.policy.allowedDomains &&
      params.policy.allowedDomains.length > 0 &&
      !params.policy.allowedDomains.includes(target.domain)
    ) {
      violations.push(
        `Target domain '${target.domain}' (${target.relativePath}) is not in allowed domains: ${params.policy.allowedDomains.join(", ")}`,
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

    if (!metrics.withinBudget) {
      violations.push(...metrics.violations);
    }
  }

  const compliant = violations.length === 0;
  const recommendedAction = compliant
    ? "Execution conforms to scoped execution policy."
    : "Scope execution to designated test files and enforce resource conservation limits.";

  return {
    compliant,
    policy: params.policy,
    targets,
    metrics,
    violations,
    recommendedAction,
    timestamp: new Date().toISOString(),
  };
}
