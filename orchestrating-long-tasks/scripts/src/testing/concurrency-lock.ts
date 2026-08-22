/**
 * Full-Suite Test Concurrency Locking & Metadata Memoization.
 *
 * Enforces single-concurrency serialization for full-suite test runs via .capsules/.locks/full-suite-test.lock
 * while allowing scoped single-file tests (bun test tests/unit/<domain>/<file>.test.ts) to bypass locks freely.
 * Supports stale lock recovery for terminated PIDs and memoizes test summary execution records.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { findRepoRoot } from "./isolation.ts";

export interface TestSummaryRecord {
  readonly timestamp_utc: string;
  readonly timestamp_local: string;
  readonly passed_count: number;
  readonly failed_count: number;
  readonly skipped_count: number;
  readonly duration_ms: number;
  readonly coverage_percentage: number | null;
  readonly commit_sha: string | null;
  readonly test_files_count: number;
  readonly scope: "full" | "scoped" | string;
  readonly agent_id?: string | undefined;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}

export interface FullSuiteTestLockPayload {
  readonly pid: number;
  readonly agent_id: string;
  readonly acquired_at_utc: string;
  readonly acquired_at_ms: number;
  readonly hostname: string;
  readonly command?: string | undefined;
}

export interface AcquireLockOptions {
  readonly runDir?: string | undefined;
  readonly agentId?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly retryIntervalMs?: number | undefined;
  readonly command?: string | undefined;
}

export interface AcquireLockResult {
  readonly acquired: boolean;
  readonly reason?: string | undefined;
  readonly lockPath?: string | undefined;
  readonly release: () => Promise<void>;
}

export interface GuardTestExecutionResult<T> {
  readonly executed: boolean;
  readonly result?: T | undefined;
  readonly reason?: string | undefined;
  readonly bypassedLock: boolean;
}

const TEST_FILE_EXTENSION_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/i;

/**
 * Checks if a given file path corresponds to a specific test/spec source file.
 */
export function isTestFilePath(targetPath: string): boolean {
  const normalized = targetPath.trim().replace(/\\/g, "/");
  return TEST_FILE_EXTENSION_PATTERN.test(normalized);
}

/**
 * Parses and tokenizes a command string or argument array into clean tokens.
 */
function tokenizeCommand(command: string | readonly string[]): string[] {
  if (typeof command === "string") {
    return command.trim().split(/\s+/).filter((entry: string) => entry.length > 0);
  }
  return command.map((entry: string) => entry.trim()).filter((entry: string) => entry.length > 0);
}


/**
 * Determines whether a command invocation represents a full-suite test execution
 * or a single-file scoped test execution.
 *
 * Full suite tests (e.g. `bun test`, `bun test tests/unit`, `npm test`, `bun test --coverage`) return true.
 * Scoped single-file tests (e.g. `bun test tests/unit/agents/grants.test.ts`) return false.
 * Non-test commands (e.g. `bun run build`, `git status`) return false.
 */
export function isFullSuiteTestCommand(command: string | readonly string[]): boolean {
  const tokens = tokenizeCommand(command);
  if (tokens.length === 0) return false;

  let testRunnerIndex = -1;
  let argsStartIndex = -1;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!.toLowerCase();
    const base = basename(token);

    if (base === "bun" || base === "npm" || base === "pnpm" || base === "yarn") {
      const next = tokens[i + 1]?.toLowerCase();
      if (next === "test" || next === "t") {
        testRunnerIndex = i;
        argsStartIndex = i + 2;
        break;
      }
      if (next === "run") {
        const afterRun = tokens[i + 2]?.toLowerCase();
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
    } else if (token === "test" && i === 0) {
      testRunnerIndex = 0;
      argsStartIndex = 1;
      break;
    }
  }

  // Not a test command
  if (testRunnerIndex === -1) return false;

  const testArgs = tokens.slice(argsStartIndex);

  // Extract positional targets, filtering out flags and flag values
  const positionalTargets: string[] = [];
  let skipNext = false;

  for (let i = 0; i < testArgs.length; i++) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    const arg = testArgs[i]!;

    if (arg.startsWith("-")) {
      // Check flags that typically take a value parameter
      if (
        arg === "--timeout" ||
        arg === "-t" ||
        arg === "--filter" ||
        arg === "-f" ||
        arg === "--reporter" ||
        arg === "-r" ||
        arg === "--cwd" ||
        arg === "--max-concurrency" ||
        arg === "--threshold"
      ) {
        skipNext = true;
      }
      continue;
    }

    positionalTargets.push(arg);
  }

  // If no positional targets specified, test runner defaults to running the full suite
  if (positionalTargets.length === 0) {
    return true;
  }

  // If any positional target is a directory or broad directory path (e.g. `tests`, `tests/unit`),
  // or not an individual test file, it's considered a full/broad suite test.
  for (const target of positionalTargets) {
    if (!isTestFilePath(target)) {
      return true;
    }
  }

  // If multiple individual test files are provided (or exactly one test file),
  // check if all are specific test files. If all are specific files, it's scoped.
  return false;
}

/**
 * Checks if a system process with the given PID is currently alive.
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ESRCH") {
      return false;
    }
    if (err.code === "EPERM") {
      // Process exists but we lack permission to signal it
      return true;
    }
    return false;
  }
}

/**
 * Resolves the absolute path to the full-suite test lock file.
 */
export function resolveLockPath(runDir?: string | undefined): string {
  if (runDir) {
    const normalized = resolve(runDir);
    if (normalized.endsWith(".lock")) return normalized;
    if (normalized.endsWith(".locks") || normalized.endsWith(".locks/")) {
      return join(normalized, "full-suite-test.lock");
    }
    return join(normalized, ".locks", "full-suite-test.lock");
  }
  const repoRoot = findRepoRoot();
  return join(repoRoot, ".capsules", ".locks", "full-suite-test.lock");
}

/**
 * Reads and parses an existing lock file, or returns null if not present or corrupt.
 */
export function readLockPayload(lockPath: string): FullSuiteTestLockPayload | null {
  if (!existsSync(lockPath)) return null;
  try {
    const content = readFileSync(lockPath, "utf8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (typeof parsed.pid === "number" && typeof parsed.agent_id === "string") {
      return {
        pid: parsed.pid,
        agent_id: parsed.agent_id,
        acquired_at_utc: typeof parsed.acquired_at_utc === "string" ? parsed.acquired_at_utc : new Date().toISOString(),
        acquired_at_ms: typeof parsed.acquired_at_ms === "number" ? parsed.acquired_at_ms : Date.now(),
        hostname: typeof parsed.hostname === "string" ? parsed.hostname : hostname(),
        command: typeof parsed.command === "string" ? parsed.command : undefined,
      };
    }
  } catch {
    // Corrupt or empty lock file
  }
  return null;
}

function delayAsync(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/**
 * Attempts to acquire the full-suite test lock with automatic stale PID recovery.
 */
export async function acquireFullSuiteTestLock(
  options: AcquireLockOptions = {},
): Promise<AcquireLockResult> {
  const lockPath = resolveLockPath(options.runDir);
  const lockDir = dirname(lockPath);
  if (!existsSync(lockDir)) {
    mkdirSync(lockDir, { recursive: true });
  }

  const agentId = options.agentId ?? `agent-${process.pid}`;
  const timeoutMs = Math.max(0, options.timeoutMs ?? 0);
  const retryIntervalMs = Math.max(10, options.retryIntervalMs ?? 50);
  const deadline = Date.now() + timeoutMs;

  const releaseFn = async (): Promise<void> => {
    try {
      if (existsSync(lockPath)) {
        const currentPayload = readLockPayload(lockPath);
        if (!currentPayload || currentPayload.pid === process.pid || currentPayload.agent_id === agentId) {
          rmSync(lockPath, { force: true });
        }
      }
    } catch {
      // Non-fatal lock release error
    }
  };

  while (true) {
    let shouldTryWrite = false;

    if (existsSync(lockPath)) {
      const existing = readLockPayload(lockPath);

      if (!existing) {
        // Corrupt lock file -> recover stale lock
        rmSync(lockPath, { force: true });
        shouldTryWrite = true;
      } else if (!isProcessAlive(existing.pid)) {
        // Process is no longer running -> recover stale lock
        rmSync(lockPath, { force: true });
        shouldTryWrite = true;
      } else {
        // Lock actively held by running process
        const now = Date.now();
        if (now < deadline) {
          const remaining = deadline - now;
          await delayAsync(Math.min(retryIntervalMs, remaining));
          continue;
        }

        return {
          acquired: false,
          reason: `Full-suite test lock held by active PID ${existing.pid} (agent: ${existing.agent_id})`,
          lockPath,
          release: releaseFn,
        };
      }
    } else {
      shouldTryWrite = true;
    }

    if (shouldTryWrite) {
      const payload: FullSuiteTestLockPayload = {
        pid: process.pid,
        agent_id: agentId,
        acquired_at_utc: new Date().toISOString(),
        acquired_at_ms: Date.now(),
        hostname: hostname(),
        command: options.command,
      };

      try {
        writeFileSync(lockPath, JSON.stringify(payload, null, 2), { flag: "wx" });
        return {
          acquired: true,
          lockPath,
          release: releaseFn,
        };
      } catch (error: unknown) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === "EEXIST") {
          // Concurrent race: another process wrote right before us
          const now = Date.now();
          if (now < deadline) {
            await delayAsync(Math.min(retryIntervalMs, deadline - now));
            continue;
          }
          const conflicting = readLockPayload(lockPath);
          return {
            acquired: false,
            reason: conflicting
              ? `Full-suite test lock held by active PID ${conflicting.pid} (agent: ${conflicting.agent_id})`
              : "Full-suite test lock collision during atomic acquisition",
            lockPath,
            release: releaseFn,
          };
        }
        throw error;
      }
    }
  }
}

/**
 * Guards test execution: scoped single-file tests bypass the lock entirely,
 * while full-suite tests acquire and hold the lock during execution.
 */
export async function guardTestExecution<T>(
  command: string | readonly string[],
  action: () => Promise<T> | T,
  options: AcquireLockOptions = {},
): Promise<GuardTestExecutionResult<T>> {
  const isFullSuite = isFullSuiteTestCommand(command);

  if (!isFullSuite) {
    // Scoped single-file test: bypass lock completely
    const result = await action();
    return {
      executed: true,
      result,
      bypassedLock: true,
    };
  }

  // Full-suite test: acquire lock
  const lock = await acquireFullSuiteTestLock(options);
  if (!lock.acquired) {
    return {
      executed: false,
      reason: lock.reason,
      bypassedLock: false,
    };
  }

  try {
    const result = await action();
    return {
      executed: true,
      result,
      bypassedLock: false,
    };
  } finally {
    await lock.release();
  }
}

/**
 * Resolves repository current commit SHA if available.
 */
function resolveCommitSha(): string | null {
  try {
    const gitHeadPath = join(findRepoRoot(), ".git", "HEAD");
    if (!existsSync(gitHeadPath)) return null;
    const headContent = readFileSync(gitHeadPath, "utf8").trim();
    if (headContent.startsWith("ref: ")) {
      const refPath = join(findRepoRoot(), ".git", headContent.slice(5).trim());
      if (existsSync(refPath)) {
        return readFileSync(refPath, "utf8").trim();
      }
    } else if (/^[0-9a-f]{40}$/i.test(headContent)) {
      return headContent;
    }
  } catch {
    // Non-fatal
  }
  return null;
}

/**
 * Creates a valid TestSummaryRecord from raw metrics and defaults.
 */
export function createTestSummaryRecord(params: {
  readonly passed_count: number;
  readonly failed_count: number;
  readonly skipped_count?: number | undefined;
  readonly duration_ms?: number | undefined;
  readonly coverage_percentage?: number | null | undefined;
  readonly commit_sha?: string | null | undefined;
  readonly test_files_count?: number | undefined;
  readonly scope?: "full" | "scoped" | string | undefined;
  readonly agent_id?: string | undefined;
  readonly timestamp_utc?: string | undefined;
  readonly timestamp_local?: string | undefined;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}): TestSummaryRecord {
  const now = new Date();
  return {
    timestamp_utc: params.timestamp_utc ?? now.toISOString(),
    timestamp_local: params.timestamp_local ?? now.toString(),
    passed_count: Math.max(0, params.passed_count),
    failed_count: Math.max(0, params.failed_count),
    skipped_count: Math.max(0, params.skipped_count ?? 0),
    duration_ms: Math.max(0, params.duration_ms ?? 0),
    coverage_percentage: params.coverage_percentage !== undefined ? params.coverage_percentage : null,
    commit_sha: params.commit_sha !== undefined ? params.commit_sha : resolveCommitSha(),
    test_files_count: Math.max(1, params.test_files_count ?? 1),
    scope: params.scope ?? (params.test_files_count && params.test_files_count > 1 ? "full" : "scoped"),
    agent_id: params.agent_id,
    details: params.details,
  };
}

/**
 * Resolves the directory where test summaries are memoized.
 */
export function resolveTestSummaryDir(runDir?: string | undefined): string {
  if (runDir) {
    const normalized = resolve(runDir);
    if (normalized.endsWith("test-summaries") || normalized.endsWith("test-summaries/")) {
      return normalized;
    }
    return join(normalized, "test-summaries");
  }
  return join(findRepoRoot(), ".capsules", "test-summaries");
}

/**
 * Saves a TestSummaryRecord to disk, updating latest.json and timestamped summary record.
 */
export async function saveTestSummary(
  summary: TestSummaryRecord,
  options: { runDir?: string | undefined } = {},
): Promise<string> {
  const summaryDir = resolveTestSummaryDir(options.runDir);
  if (!existsSync(summaryDir)) {
    mkdirSync(summaryDir, { recursive: true });
  }

  const safeTimestamp = summary.timestamp_utc.replace(/[:.]/g, "-");
  const fileName = `summary-${safeTimestamp}.json`;
  const filePath = join(summaryDir, fileName);
  const latestPath = join(summaryDir, "latest.json");

  const jsonContent = JSON.stringify(summary, null, 2);
  writeFileSync(filePath, jsonContent, "utf8");
  writeFileSync(latestPath, jsonContent, "utf8");

  return filePath;
}

/**
 * Retrieves the latest memoized TestSummaryRecord, or null if none exists.
 */
export async function getLatestTestSummary(
  options: { runDir?: string | undefined } = {},
): Promise<TestSummaryRecord | null> {
  const summaryDir = resolveTestSummaryDir(options.runDir);
  if (!existsSync(summaryDir)) return null;

  const latestPath = join(summaryDir, "latest.json");
  if (existsSync(latestPath)) {
    try {
      const content = readFileSync(latestPath, "utf8");
      return JSON.parse(content) as TestSummaryRecord;
    } catch {
      // Fall through to directory inspection
    }
  }

  try {
    const entries = readdirSync(summaryDir)
      .filter((file) => file.startsWith("summary-") && file.endsWith(".json"))
      .map((file) => {
        const full = join(summaryDir, file);
        return { file: full, mtime: statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    if (entries.length > 0) {
      const content = readFileSync(entries[0]!.file, "utf8");
      return JSON.parse(content) as TestSummaryRecord;
    }
  } catch {
    // Non-fatal
  }

  return null;
}

/**
 * Formats a TestSummaryRecord into an executive markdown brief.
 */
export function formatTestSummaryMarkdown(summary: TestSummaryRecord): string {
  const isPassing = summary.passed_count > 0 && summary.failed_count === 0;
  const statusIcon = isPassing ? "✅ PASSED" : summary.failed_count > 0 ? "❌ FAILED" : "⚠️ NO_TESTS";

  const lines: string[] = [
    `### Test Execution Summary: \`${summary.scope}\``,
    `- **Status**: ${statusIcon}`,
    `- **Passed**: ${summary.passed_count}`,
    `- **Failed**: ${summary.failed_count}`,
    `- **Skipped**: ${summary.skipped_count}`,
    `- **Duration**: ${summary.duration_ms}ms`,
    `- **Coverage**: ${summary.coverage_percentage !== null ? `${summary.coverage_percentage.toFixed(1)}%` : "N/A"}`,
    `- **Files Audited**: ${summary.test_files_count}`,
    `- **Commit SHA**: ${summary.commit_sha ? `\`${summary.commit_sha.slice(0, 8)}\`` : "N/A"}`,
    `- **Timestamp (UTC)**: \`${summary.timestamp_utc}\``,
    `- **Timestamp (Local)**: \`${summary.timestamp_local}\``,
  ];

  if (summary.agent_id) {
    lines.push(`- **Recorded By**: \`${summary.agent_id}\``);
  }

  return lines.join("\n");
}
