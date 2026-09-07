# Monorepo Unit Testing Standards & In-Memory Purity

## 1. Executive Summary & Axiomatic Invariants

In this monorepo, unit tests serve as deterministic, isolated, and millisecond-speed behavioral verifications for individual modules. Fast feedback loops require high test execution velocity and complete parallel safety. To ensure reliability across hundreds of test suites running concurrently, all unit tests must strictly adhere to the following core invariants:

1. **100% In-Memory Virtual Mocking Invariant (`ZERO_DISK_IO_TESTING_INVARIANT`)**: Unit tests across all domains (`tests/<domain>/*`) must NEVER perform real filesystem writes (`writeFileSync`, `mkdirSync`, `rmSync`, `appendFileSync`, `unlinkSync`, etc.), read real files from disk for testing, spawn real subprocesses, or allocate physical scratch directories (`./runtime/`, `.tmp/`, `/tmp`).
2. **Sub-10ms Latency Target ($P_{90} \le 10\text{ms}$)**: Every unit test file must execute within 10 milliseconds. Spawning OS processes, reading physical disk blocks, or booting heavyweight language compilers introduces hundreds of milliseconds of non-deterministic latency and is strictly barred.
3. **Strict Separation of Verification Concerns**: Unit tests test isolated module runtime behavior in RAM. Prohibited in unit tests: static repository AST inspection, reading repo `.ts` files from disk, file line-count audits (e.g. verifying files are $\le 300$ lines), scanning for `any` types, or checking compiler suppressions. Codebase-wide structural and AST invariants belong exclusively to `task:check`, oxlint, and git pre-commit hooks.

---

## 2. In-Memory Virtual Mocking Architecture

### 2.1 The `VirtualMemoryFS` Engine

The repository provides a complete in-memory POSIX filesystem emulator located at [`olt/scripts/src/testing/virtual-fs/index.ts`](../scripts/src/testing/virtual-fs/index.ts):

- **Zero Physical Disk Writes**: All nodes (files, directories, symlinks) are stored in an in-memory tree (`Map<string, VirtualFSNode>`).
- **Synchronous & Asynchronous POSIX Semantics**: Provides `readFileSync`, `writeFileSync`, `mkdirSync`, `rmSync`, `readdirSync`, `statSync`, `existsSync`, etc. in RAM with instant microsecond response times.
- **Hermetic Isolation**: Each test suite or test case initializes a fresh instance of `VirtualMemoryFS` or invokes `createVirtualFSSession()` to avoid cross-test pollution.

```ts
import { describe, expect, it, beforeEach } from "bun:test";
import { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("ConfigLoader Unit Tests", () => {
  let vfs: VirtualMemoryFS;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync("/app/config", { recursive: true });
    vfs.writeFileSync("/app/config/settings.json", JSON.stringify({ timeoutMs: 500 }));
  });

  it("loads settings from virtual filesystem", () => {
    const raw = vfs.readFileSync("/app/config/settings.json", "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.timeoutMs).toBe(500);
  });
});
```

### 2.2 Virtual Adapters & Synthetic Metadata

Where services interact with host metadata or timers, use dedicated synthetic adapters:

- **`MemoryFsAdapter`**: Adapter interface wrapping virtual filesystem operations for core subsystems.
- **Synthetic Metadata**: Enable via `enableInMemoryAgentMetadata()` and clean up with `disableInMemoryAgentMetadata()`.
- **Synthetic Clocks**: Stub timers using deterministic time offsets (`Date.now()` or virtual clock ticks) rather than real delays (`setTimeout`, `sleep`).

```ts
import {
  enableInMemoryAgentMetadata,
  disableInMemoryAgentMetadata,
} from "../../../olt/scripts/src/testing/virtual-metadata.ts";

describe("Agent Lifecycle Unit Tests", () => {
  beforeEach(() => {
    enableInMemoryAgentMetadata({ agentId: "test-agent-1", role: "implementer" });
  });

  afterEach(() => {
    disableInMemoryAgentMetadata();
  });

  it("operates on synthetic in-memory metadata without touching host disk", () => {
    // Verified purely against RAM structures
  });
});
```

---

## 3. Strict Ban on Static AST & Source Scanning in Unit Tests

### 3.1 Why AST Inspection in Unit Tests is an Anti-Pattern

A recurring anti-pattern is writing unit tests that traverse the repository source tree, read `.ts` files from disk, and parse them with TypeScript's compiler API to assert:

- Source files have $\le 300$ lines of code.
- Zero `any` types exist in the codebase.
- Zero compiler suppressions (`@ts-ignore`, `@ts-expect-error`) exist.

This practice is prohibited in unit tests for three key reasons:

1. **Scope Confusion**: Unit tests exist to verify runtime behavior and edge cases of functions, classes, and modules against inputs and outputs. Structural static code audits are linting/typechecking tasks, not unit tests.
2. **Performance Degradation**: Booting `ts.createProgram`, `ts.createLanguageService`, or reading hundreds of files from disk takes 200ms–2000ms per test file, completely violating the sub-10ms requirement.
3. **Flaky Dependency on Git State**: Tests fail when unrelated files are edited, breaking test parallelization and git worktree isolation.

### 3.2 Proper Delegation of Static Codebase Audits

All static codebase rules are enforced through the static analysis pipeline:

| Check                         | Canonical Pipeline Home                 | Command                     |
| ----------------------------- | --------------------------------------- | --------------------------- |
| Line counts ($\le 300$ lines) | AST Linter / Pre-commit                 | `bun harness.ts task:check` |
| Zero `any` types              | AST Linter rule: `any_type`             | `bun harness.ts task:check` |
| Zero compiler suppressions    | AST Linter rule: `compiler_suppression` | `bun harness.ts task:check` |
| Type correctness              | TypeScript Compiler                     | `bun x tsc --noEmit`        |
| Syntax & style                | Oxlint / Biome                          | `bun x oxlint`              |

> [!NOTE]
> **Synthetic String Parsing in Linter Unit Tests Permitted**: Linter unit tests that verify AST rule logic on small, synthetic string literals in RAM (e.g. `lintSourceCode("const x: any = 1;", "test.ts")` or `ts.createSourceFile("inline.ts", code, ts.ScriptTarget.Latest)`) are fully permitted. What is strictly banned is reading actual repository source files from disk to assert metrics.

---

## 4. Strict Ban on Subprocess Invocations in Unit Tests

### 4.1 Prohibition of Real Subprocesses

Unit tests must NEVER execute real operating system processes. Prohibited APIs include:

- `child_process.exec`, `child_process.execSync`
- `child_process.spawn`, `child_process.spawnSync`
- `child_process.fork`, `child_process.execFile`, `child_process.execFileSync`
- `Bun.spawn`, `Bun.spawnSync`, `Bun.$`

### 4.2 Why Subprocesses are Barred

1. **Massive Latency**: Spawning a shell or subprocess costs 50ms–250ms per invocation on macOS/Linux. In a suite of 50 tests, subprocesses balloon execution time from 0.1s to over 10 seconds.
2. **Environment Contamination**: Real subprocesses execute against the host machine's environment, inheriting ambient environment variables, PATH, installed binaries, and git state.
3. **Flakiness & Race Conditions**: Subprocesses can hang, leave orphaned child processes, or collide with concurrent test runners accessing shared system resources.

### 4.3 Compliant Subprocess Mocking

To test code that would ordinarily spawn a process, inject a virtual process runner or stub the execution handler:

```ts
// Anti-Pattern: Real Subprocess
import { execSync } from "node:child_process";
test("gets git branch", () => {
  const branch = execSync("git rev-parse --abbrev-ref HEAD").toString().trim();
  expect(branch).toBeDefined();
});

// Compliant: In-Memory Mocking / Dependency Injection
interface CommandRunner {
  run(command: string): string;
}

test("gets git branch with virtual command runner", () => {
  const mockRunner: CommandRunner = {
    run: (cmd) => {
      if (cmd.includes("git rev-parse")) return "main";
      throw new Error(`Unknown command: ${cmd}`);
    },
  };
  const branch = getBranchName(mockRunner);
  expect(branch).toBe("main");
});
```

---

## 5. Performance Benchmark & Parallel Isolation

- **Latency Threshold**: Every test file must execute with $P_{90} \le 10\text{ms}$.
- **Parallel Safety**: Because tests execute purely in RAM with no disk writes and no subprocesses, test files can be executed with arbitrary concurrency across all available CPU cores without lock contention, port collisions, or race conditions.
- **Clean Teardown**: In-memory data structures are reclaimed instantaneously by the garbage collector upon test suite termination, leaving zero residual disk artifacts.

---

## 6. Anti-Pattern & Remediation Catalog

### Example 1: Physical Disk Writing vs. `VirtualMemoryFS`

```ts
// ❌ PROHIBITED: Writing to real disk / scratch paths
import * as fs from "node:fs";
test("saves state", () => {
  fs.mkdirSync(".tmp/scratch", { recursive: true });
  fs.writeFileSync(".tmp/scratch/state.json", '{"active": true}');
  expect(fs.existsSync(".tmp/scratch/state.json")).toBe(true);
  fs.rmSync(".tmp/scratch", { recursive: true }); // Cleanup is fragile!
});

// ✅ COMPLIANT: 100% In-Memory VirtualMemoryFS
import { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
test("saves state in memory", () => {
  const vfs = new VirtualMemoryFS();
  vfs.mkdirSync("/tmp/scratch", { recursive: true });
  vfs.writeFileSync("/tmp/scratch/state.json", '{"active": true}');
  expect(vfs.existsSync("/tmp/scratch/state.json")).toBe(true);
  expect(JSON.parse(vfs.readFileSync("/tmp/scratch/state.json", "utf8"))).toEqual({ active: true });
});
```

### Example 2: Subprocess Execution vs. In-Memory Function Stub

```ts
// ❌ PROHIBITED: Spawning real processes
import { spawnSync } from "node:child_process";
test("compiles file", () => {
  const res = spawnSync("oxlint", ["src/index.ts"]);
  expect(res.status).toBe(0);
});

// ✅ COMPLIANT: Pure in-memory unit verification
test("compiles file via parser stub", () => {
  const stubValidator = (src: string) => src.length > 0;
  expect(stubValidator("export const a = 1;")).toBe(true);
});
```

### Example 3: AST Inspection in Unit Test vs. `task:check`

```ts
// ❌ PROHIBITED: Inspecting repository disk files in unit tests
import * as fs from "node:fs";
test("all files under src are <= 300 lines", () => {
  const files = fs.readdirSync("src");
  for (const f of files) {
    const lines = fs.readFileSync(`src/${f}`, "utf8").split("\n");
    expect(lines.length).toBeLessThanOrEqual(300);
  }
});

// ✅ COMPLIANT: Handled via AST Linter rule in task:check
// Run static analysis out-of-band:
// $ bun harness.ts task:check
```

---

## 7. Automated AST Linter Enforcement (`unit_test_purity`)

The AST linter rule `unit_test_purity` ([`olt/scripts/src/linter/rules/testing/unit_test_purity.ts`](../scripts/src/linter/rules/testing/unit_test_purity.ts)) automatically validates test files during `task:check` and pre-commit checks:

- **Flags real filesystem imports** (`fs`, `fs/promises`, and their `node:` prefixed equivalents) via static or dynamic import.
- **Flags real filesystem require calls** (`require("node:fs")`).
- **Flags unmocked filesystem calls** (`writeFileSync`, `readFileSync`, `mkdirSync`, `statSync`, etc., outside of `VirtualMemoryFS` / mock receivers).
- **Flags subprocess imports and calls** (`child_process`, `node:child_process`, `execSync`, `spawnSync`, `Bun.spawn`, `Bun.$`).
- **Flags heavyweight AST inspection** (`ts.createProgram`, `ts.createLanguageService`, `ts.readConfigFile` in test files).
- **Provides automated fix suggestions** pointing to `VirtualMemoryFS`, virtual adapters, or `task:check`.
