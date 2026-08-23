# Plan 5: Locked Test Runner, Concurrency Mutex & Sync Remote Alignment

## 1. Context & Problem Statement

### Problem A: Bare `bun test` Bypassing Custom Flags

When agents or CLI invocations execute bare `bun test <path>` instead of using the repository's custom test runner, Bun falls back to its default configuration:

- **Default Timeout**: 5,000ms instead of the required **30,000ms** for complex admission matrix / subprocess tests.
- **Isolation/Parallelism**: Drops `--parallel --no-isolate`, resulting in sequential execution bottlenecks and false timeout failures.

### Problem B: Duplicate Major Test Runs Starving Machine Resources

When multiple agents or automated processes launch broad-scope test runs (e.g. against the entire `tests/` directory, `tests/unit/`, or `--coverage`) simultaneously:

- Competing runs saturate all CPU cores and memory.
- Previous runs forgotten in the background continue burning compute while new runs are dispatched.
- Both runs degrade, timeout, and freeze indefinitely.

### Problem C: Outdated `sync:remote` Script

`package.json` contains:

```json
"sync:remote": "npx skills update orchestrating-long-tasks -g -y"
```

The skill was officially renamed to **`olt`**, causing `sync:remote` to fail or target an obsolete package name.

---

## 2. Objectives & Acceptance Criteria

1. **Deterministic Test Runner (`scripts/test-runner.ts`):**
   - Centralized runner script that automatically injects canonical flags (`--timeout 30000 --parallel --no-isolate`) into every test invocation.
   - Allows passing targeted file arguments (e.g. `bun scripts/test-runner.ts tests/unit/policy/rbac.test.ts`) while guaranteeing default flags remain active.
2. **PID-Based Process Mutex on Broad-Scope Test Runs (`.olt/.locks/test-runner.lock`):**
   - **Scope Classification**:
     - **Major / Broad-Scope**: Invocations targeting `tests/`, `tests/unit/`, `--coverage`, or full repo.
     - **Targeted / Micro-Scope**: Invocations targeting 1 or 2 specific test files.
   - **Mutex Invariant**: Exactly **one** broad-scope test run can execute at any time.
   - If a major run is attempted while another is active:
     - Check if the PID is alive (`process.kill(pid, 0)`).
     - If alive: Block immediately with exit code 1:
       `[LOCKED_TEST_RUNNER] A major test run is already active (PID: <pid>, started: <timestamp>). Concurrent execution blocked to prevent CPU starvation.`
     - If dead (stale crash): Automatically reclaim the lock, log a notice, and proceed.
   - Lock is released reliably via `process.on('exit')`, `SIGINT`, `SIGTERM`, and `try/finally`.
3. **Targeted Tests Non-Blocking:**
   - Single-file targeted unit tests must not block other targeted test files unless they touch the exact same file.
4. **`package.json` & Sync Alignment:**
   - Update `test`, `test:coverage`, `test:changed`, and `sync:remote` scripts in `package.json`.

---

## 3. Detailed Technical Architecture

### 3.1 Mutex Lock Manager (`scripts/test-mutex.ts`)

```typescript
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface TestLockData {
  readonly pid: number;
  readonly scope: "broad" | "targeted";
  readonly args: readonly string[];
  readonly startedAt: string;
}

const LOCK_DIR = ".olt/.locks";
const BROAD_LOCK_FILE = join(LOCK_DIR, "broad-test.lock");

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireTestLock(isBroadScope: boolean, args: readonly string[]): () => void {
  if (!isBroadScope) {
    return () => {}; // Targeted runs do not require global broad lock
  }

  mkdirSync(LOCK_DIR, { recursive: true });

  if (existsSync(BROAD_LOCK_FILE)) {
    try {
      const raw = readFileSync(BROAD_LOCK_FILE, "utf-8");
      const lock: TestLockData = JSON.parse(raw);

      if (isProcessAlive(lock.pid)) {
        console.error(
          `\x1b[31m[LOCKED_TEST_RUNNER]\x1b[0m A major test run is already active!\n` +
            `  PID: ${lock.pid}\n` +
            `  Scope: ${lock.args.join(" ")}\n` +
            `  Started: ${lock.startedAt}\n` +
            `\x1b[33mDuplicate execution blocked to prevent resource starvation. Wait for current run to finish or kill PID ${lock.pid}.\x1b[0m`,
        );
        process.exit(1);
      } else {
        // Reclaim stale lock
        unlinkSync(BROAD_LOCK_FILE);
      }
    } catch {
      // Corrupt lock file, reclaim
      try {
        unlinkSync(BROAD_LOCK_FILE);
      } catch {}
    }
  }

  const lockData: TestLockData = {
    pid: process.pid,
    scope: "broad",
    args,
    startedAt: new Date().toISOString(),
  };

  writeFileSync(BROAD_LOCK_FILE, JSON.stringify(lockData, null, 2));

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      if (existsSync(BROAD_LOCK_FILE)) {
        const raw = readFileSync(BROAD_LOCK_FILE, "utf-8");
        const data = JSON.parse(raw);
        if (data.pid === process.pid) {
          unlinkSync(BROAD_LOCK_FILE);
        }
      }
    } catch {}
  };

  process.on("exit", release);
  process.on("SIGINT", () => {
    release();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    release();
    process.exit(143);
  });
  process.on("uncaughtException", (err) => {
    release();
    console.error(err);
    process.exit(1);
  });

  return release;
}
```

### 3.2 Canonical Test Runner (`scripts/test-runner.ts`)

```typescript
#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { acquireTestLock } from "./test-mutex.ts";

const rawArgs = process.argv.slice(2);

// Detect if broad scope or targeted
const isCoverage = rawArgs.includes("--coverage");
const fileTargets = rawArgs.filter((arg) => !arg.startsWith("-"));
const isBroadScope =
  fileTargets.length === 0 ||
  fileTargets.some(
    (t) => t === "tests" || t === "tests/unit" || t === "tests/" || t === "tests/unit/",
  );

const releaseLock = acquireTestLock(isBroadScope || isCoverage, rawArgs);

try {
  const defaultFlags = ["--timeout", "30000", "--parallel", "--no-isolate"];
  const finalArgs = ["test", ...defaultFlags, ...rawArgs];

  const result = spawnSync("bun", finalArgs, {
    stdio: "inherit",
    env: process.env,
  });

  process.exit(result.status ?? 0);
} finally {
  releaseLock();
}
```

---

## 4. `package.json` Updates

```json
{
  "scripts": {
    "test": "bun scripts/test-runner.ts tests/unit",
    "test:all": "bun scripts/test-runner.ts tests",
    "test:coverage": "bun scripts/test-runner.ts --coverage tests/unit",
    "test:changed": "bun scripts/test-changed.ts",
    "sync:local": "bun scripts/sync-global.ts",
    "sync:remote": "npx skills update olt -g -y",
    "sync": "bun run sync:local"
  }
}
```

---

## 5. Implementation Steps

1. **Step 1:** Implement `scripts/test-mutex.ts` with atomic PID checking, stale lock auto-reclaim, and process exit handlers.
2. **Step 2:** Implement `scripts/test-runner.ts` that enforces `--timeout 30000 --parallel --no-isolate` and binds to the test mutex.
3. **Step 3:** Update `package.json` test and sync scripts.
4. **Step 4:** Add unit tests in `tests/unit/scripts/test-mutex.test.ts` verifying:
   - Broad run creates lock.
   - Concurrent broad run is blocked with exit code 1.
   - Targeted runs bypass broad lock.
   - Stale lock from dead PID is reclaimed automatically.
   - Lock is released upon process exit.
