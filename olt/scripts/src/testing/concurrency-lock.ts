/**
 * Full-Suite Test Concurrency Locking & Metadata Memoization.
 * Enforces single-concurrency serialization for full-suite test runs with zero-disk in-memory fallback.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
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

const TEST_EXT_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$/i;
const isTestEnv =
  process.env.NODE_ENV === "test" ||
  process.env.BUN_ENV === "test" ||
  process.env.OLT_VIRTUAL_FS === "1";
const inMemLocks = new Map<string, FullSuiteTestLockPayload | "corrupt">();
const inMemSummaries = new Map<string, { summary: TestSummaryRecord; mtime: number }>();

export function resetConcurrencyLockStore(): void {
  inMemLocks.clear();
  inMemSummaries.clear();
}
export function setInMemoryLockPayload(
  path: string,
  payload: FullSuiteTestLockPayload | "corrupt" | null,
): void {
  if (payload === null) inMemLocks.delete(path);
  else inMemLocks.set(path, payload);
}
export function isTestFilePath(targetPath: string): boolean {
  return TEST_EXT_RE.test(targetPath.trim().replace(/\\/g, "/"));
}

function tokenize(cmd: string | readonly string[]): string[] {
  if (typeof cmd === "string")
    return cmd
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 0);
  return cmd.map((t) => t.trim()).filter((t) => t.length > 0);
}

export function isFullSuiteTestCommand(command: string | readonly string[]): boolean {
  const tokens = tokenize(command);
  if (tokens.length === 0) return false;
  let rIdx = -1,
    aIdx = -1;
  for (let i = 0; i < tokens.length; i++) {
    const base = basename(tokens[i]!.toLowerCase());
    if (base === "bun" || base === "npm" || base === "pnpm" || base === "yarn") {
      const n1 = tokens[i + 1]?.toLowerCase();
      if (n1 === "test" || n1 === "t") {
        rIdx = i;
        aIdx = i + 2;
        break;
      }
      if (
        n1 === "run" &&
        (tokens[i + 2]?.toLowerCase() === "test" || tokens[i + 2]?.toLowerCase() === "t")
      ) {
        rIdx = i;
        aIdx = i + 3;
        break;
      }
    } else if (base === "vitest" || base === "jest") {
      rIdx = i;
      aIdx = i + 1;
      break;
    } else if (tokens[i]!.toLowerCase() === "test" && i === 0) {
      rIdx = 0;
      aIdx = 1;
      break;
    }
  }
  if (rIdx === -1) return false;
  const args = tokens.slice(aIdx),
    targets: string[] = [];
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
  ]);
  for (const arg of args) {
    if (skip) {
      skip = false;
      continue;
    }
    if (arg.startsWith("-")) {
      if (valFlags.has(arg)) skip = true;
      continue;
    }
    targets.push(arg);
  }
  return targets.length === 0 || targets.some((t) => !isTestFilePath(t));
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function resolveLockPath(runDir?: string | undefined): string {
  if (runDir) {
    const norm = resolve(runDir);
    if (norm.endsWith(".lock")) return norm;
    return norm.endsWith(".locks") || norm.endsWith(".locks/")
      ? join(norm, "full-suite-test.lock")
      : join(norm, ".locks", "full-suite-test.lock");
  }
  return join(findRepoRoot(), ".capsules", ".locks", "full-suite-test.lock");
}

export function readLockPayload(lockPath: string): FullSuiteTestLockPayload | null {
  const mem = inMemLocks.get(lockPath);
  if (mem !== undefined) return mem === "corrupt" ? null : mem;
  if (!existsSync(lockPath)) return null;
  try {
    const p = JSON.parse(readFileSync(lockPath, "utf8")) as Record<string, unknown>;
    if (typeof p.pid === "number" && typeof p.agent_id === "string") {
      return {
        pid: p.pid,
        agent_id: p.agent_id,
        hostname: typeof p.hostname === "string" ? p.hostname : hostname(),
        acquired_at_utc:
          typeof p.acquired_at_utc === "string" ? p.acquired_at_utc : new Date().toISOString(),
        acquired_at_ms: typeof p.acquired_at_ms === "number" ? p.acquired_at_ms : Date.now(),
        command: typeof p.command === "string" ? p.command : undefined,
      };
    }
  } catch {
    /* Corrupted */
  }
  return null;
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function acquireFullSuiteTestLock(
  options: AcquireLockOptions = {},
): Promise<AcquireLockResult> {
  const lockPath = resolveLockPath(options.runDir);
  const agentId = options.agentId ?? `agent-${process.pid}`;
  const timeoutMs = Math.max(0, options.timeoutMs ?? 0);
  const retryIntervalMs = Math.max(10, options.retryIntervalMs ?? 50);
  const deadline = Date.now() + timeoutMs;
  const release = async (): Promise<void> => {
    try {
      const cur = readLockPayload(lockPath);
      if (!cur || cur.pid === process.pid || cur.agent_id === agentId) {
        inMemLocks.delete(lockPath);
        if (existsSync(lockPath)) rmSync(lockPath, { force: true });
      }
    } catch {
      /* Non-fatal */
    }
  };
  while (true) {
    if (inMemLocks.has(lockPath) || existsSync(lockPath)) {
      const existing = readLockPayload(lockPath);
      if (!existing || !isProcessAlive(existing.pid)) {
        inMemLocks.delete(lockPath);
        if (existsSync(lockPath)) rmSync(lockPath, { force: true });
      } else {
        const now = Date.now();
        if (now < deadline) {
          await delay(Math.min(retryIntervalMs, deadline - now));
          continue;
        }
        return {
          acquired: false,
          reason: `Full-suite test lock held by active PID ${existing.pid} (agent: ${existing.agent_id})`,
          lockPath,
          release,
        };
      }
    }
    const payload: FullSuiteTestLockPayload = {
      pid: process.pid,
      agent_id: agentId,
      acquired_at_utc: new Date().toISOString(),
      acquired_at_ms: Date.now(),
      hostname: hostname(),
      command: options.command,
    };
    if (isTestEnv) {
      inMemLocks.set(lockPath, payload);
      return { acquired: true, lockPath, release };
    }
    try {
      const dir = dirname(lockPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(lockPath, JSON.stringify(payload, null, 2), { flag: "wx" });
      return { acquired: true, lockPath, release };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        const now = Date.now();
        if (now < deadline) {
          await delay(Math.min(retryIntervalMs, deadline - now));
          continue;
        }
        const conf = readLockPayload(lockPath);
        return {
          acquired: false,
          reason: conf
            ? `Full-suite test lock held by active PID ${conf.pid} (agent: ${conf.agent_id})`
            : "Lock collision",
          lockPath,
          release,
        };
      }
      throw error;
    }
  }
}

export async function guardTestExecution<T>(
  command: string | readonly string[],
  action: () => Promise<T> | T,
  options: AcquireLockOptions = {},
): Promise<GuardTestExecutionResult<T>> {
  if (!isFullSuiteTestCommand(command))
    return { executed: true, result: await action(), bypassedLock: true };
  const lock = await acquireFullSuiteTestLock(options);
  if (!lock.acquired) return { executed: false, reason: lock.reason, bypassedLock: false };
  try {
    return { executed: true, result: await action(), bypassedLock: false };
  } finally {
    await lock.release();
  }
}

function resolveCommitSha(): string | null {
  try {
    const head = join(findRepoRoot(), ".git", "HEAD");
    if (!existsSync(head)) return null;
    const txt = readFileSync(head, "utf8").trim();
    if (txt.startsWith("ref: ")) {
      const ref = join(findRepoRoot(), ".git", txt.slice(5).trim());
      return existsSync(ref) ? readFileSync(ref, "utf8").trim() : null;
    }
    return /^[0-9a-f]{40}$/i.test(txt) ? txt : null;
  } catch {
    return null;
  }
}

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
    coverage_percentage:
      params.coverage_percentage !== undefined ? params.coverage_percentage : null,
    commit_sha: params.commit_sha !== undefined ? params.commit_sha : resolveCommitSha(),
    test_files_count: Math.max(1, params.test_files_count ?? 1),
    scope:
      params.scope ?? (params.test_files_count && params.test_files_count > 1 ? "full" : "scoped"),
    agent_id: params.agent_id,
    details: params.details,
  };
}

export function resolveTestSummaryDir(runDir?: string | undefined): string {
  if (runDir) {
    const norm = resolve(runDir);
    return norm.endsWith("test-summaries") || norm.endsWith("test-summaries/")
      ? norm
      : join(norm, "test-summaries");
  }
  return join(findRepoRoot(), ".capsules", "test-summaries");
}

export async function saveTestSummary(
  summary: TestSummaryRecord,
  options: { runDir?: string | undefined } = {},
): Promise<string> {
  const sDir = resolveTestSummaryDir(options.runDir);
  const safeTs = summary.timestamp_utc.replace(/[:.]/g, "-");
  const filePath = join(sDir, `summary-${safeTs}.json`);
  const latestPath = join(sDir, "latest.json");
  const now = Date.now();
  inMemSummaries.set(filePath, { summary, mtime: now });
  inMemSummaries.set(latestPath, { summary, mtime: now });
  if (!isTestEnv) {
    if (!existsSync(sDir)) mkdirSync(sDir, { recursive: true });
    const json = JSON.stringify(summary, null, 2);
    writeFileSync(filePath, json, "utf8");
    writeFileSync(latestPath, json, "utf8");
  }
  return filePath;
}

export async function getLatestTestSummary(
  options: { runDir?: string | undefined } = {},
): Promise<TestSummaryRecord | null> {
  const sDir = resolveTestSummaryDir(options.runDir);
  const latestPath = join(sDir, "latest.json");
  const memLatest = inMemSummaries.get(latestPath);
  if (memLatest) return memLatest.summary;
  const matches: { summary: TestSummaryRecord; mtime: number }[] = [];
  for (const [k, v] of inMemSummaries.entries()) {
    if (k.startsWith(sDir) && k.includes("summary-") && k.endsWith(".json")) matches.push(v);
  }
  if (matches.length > 0) {
    matches.sort((a, b) => b.mtime - a.mtime);
    return matches[0]!.summary;
  }
  if (existsSync(latestPath)) {
    try {
      return JSON.parse(readFileSync(latestPath, "utf8")) as TestSummaryRecord;
    } catch {
      /* Fallback */
    }
  }
  if (existsSync(sDir)) {
    try {
      const files = readdirSync(sDir)
        .filter((f) => f.startsWith("summary-") && f.endsWith(".json"))
        .map((f) => ({ full: join(sDir, f), mtime: statSync(join(sDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      if (files.length > 0)
        return JSON.parse(readFileSync(files[0]!.full, "utf8")) as TestSummaryRecord;
    } catch {
      /* Non-fatal */
    }
  }
  return null;
}

export function formatTestSummaryMarkdown(summary: TestSummaryRecord): string {
  const isPass = summary.passed_count > 0 && summary.failed_count === 0;
  const status = isPass ? "✅ PASSED" : summary.failed_count > 0 ? "❌ FAILED" : "⚠️ NO_TESTS";
  const lines = [
    `### Test Execution Summary: \`${summary.scope}\``,
    `- **Status**: ${status}`,
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
  if (summary.agent_id) lines.push(`- **Recorded By**: \`${summary.agent_id}\``);
  return lines.join("\n");
}
