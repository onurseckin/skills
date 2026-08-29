# Plan 27: Capsule Nesting Prevention & Deterministic Repo Root Traversal Isolation

> **Status:** Approved / Ready for Execution  
> **Spec Reference:** `AGENTS.md` (Axiom 3: Disjoint Write Scope Invariant, Axiom 27: Canonical `olt/` Directory, Axiom 30: Root Directory Hygiene)  
> **Corpus / Subsystem:** `olt/scripts/src/core/shared/paths.ts`, `olt/scripts/src/engine/store/`, `olt/scripts/src/policy/repo-policy.ts`, `olt/scripts/src/reporting/doctor.ts`, `tests/unit/store/`, `tests/unit/contracts/`

---

## 1. First-Principles Problem Analysis & Empirical Reality Check

### 1.1 The Recursive Capsule Nesting Defect

During test execution and multi-agent lifecycle operations, unintended recursive directory trees were materialized on disk:
`<repo-root>/.olt/capsules/.olt/capsules/test-load-relative-candidate-run`

This recursive directory structure violates core repository invariants, creates ghost capsules, pollutes workspace boundaries, and risks cascading corruption when subagents or background tasks resolve repository paths.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    RECURSIVE CAPSULE NESTING DEFECT                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Live Monorepo Root: /Users/.../repos/skills                                │
│    └── .olt/                                                                │
│        └── capsules/                                                        │
│            └── .olt/                    <-- ❌ NESTED DIRECTORY ANOMALY     │
│                └── capsules/                                                │
│                    └── test-load-relative-candidate-run/                   │
│                        ├── manifest.json                                    │
│                        ├── state.json                                       │
│                        └── prompt.md                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Upward Traversal Short-Circuit & Dead Stripping Logic

Inspection of [`olt/scripts/src/core/shared/paths.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/core/shared/paths.ts#L24-L53) revealed the root cause in `findRepoRoot()`:

```typescript
export function findRepoRoot(startDir: string = process.cwd()): string {
  let current = resolve(startDir);
  while (true) {
    if (
      !current.endsWith("/olt/scripts") &&
      !current.endsWith("/olt") &&
      (existsSync(join(current, OLT_DIR_NAME)) || // ❌ MATCHES in-capsule .olt
        existsSync(join(current, ".git")) ||
        existsSync(join(current, "package.json"))) // ❌ MATCHES in-capsule workspace package.json
    ) {
      return current; // ❌ Halts prematurely at capsule directory!
    }
    const parent = resolve(current, "..");
    if (parent === current) {
      break;
    }
    current = parent;
  }
  // ❌ DEAD CODE: Unreachable because the while loop always returns or reaches root
  const resolved = resolve(startDir);
  if (resolved.includes("/.olt/capsules/")) {
    return resolved.split("/.olt/capsules/")[0] || resolved;
  }
  ...
}
```

1. **Premature Short-Circuit on In-Capsule Markers:** When `startDir` is inside a capsule workspace (e.g. `/repo/.olt/capsules/run-abc/sub/dir`), and that capsule contains an internal `.olt/` folder, `.git` submodule/worktree, or `package.json` file, `findRepoRoot` encounters `existsSync(...)` on its upward traversal and returns the capsule workspace as the repository root.
2. **Post-Loop Stripping is Unreachable Dead Code:** The suffix/capsule stripping logic (`resolved.includes("/.olt/capsules/")`) is placed after the `while (true)` loop. Because the loop either returns a matched directory or breaks at filesystem root `/` and returns `/`, lines 42–52 are never executed.
3. **Double-Nesting in `resolveCapsulesDir`:** When `resolveCapsulesDir(repoRoot)` receives an un-sanitized root or capsule path, it naively joins `root + "/.olt/capsules"`, compounding paths into `.olt/capsules/.olt/capsules`.
4. **Defenseless `initRun`:** `initRun()` in [`olt/scripts/src/engine/store/index.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/engine/store/index.ts#L26-L53) performs no validation against `isInsideCapsule(repoRoot)`, allowing callers to initialize capsules inside existing capsule directories without throwing `PATH_SAFETY`.

### 1.3 Symlinks, Submodules, Git Worktrees & Deep Workspaces

- **Git Worktrees:** In a git worktree, `.git` is a regular file (`gitdir: /path/to/main/.git/worktrees/...`), not a directory. `existsSync(join(current, ".git"))` correctly evaluates to `true`, but if worktree files exist inside a capsule workspace, upward traversal must not anchor to them.
- **Symlinked Paths:** On platforms like macOS where `/var` is a symlink to `/private/var`, non-canonicalized paths cause prefix checks to fail unless path resolution is normalized with `resolve()` and segment boundaries.
- **Deeply Nested Workspaces:** If a test or subagent operates in `<capsule>/workspace/packages/sub-app`, `findRepoRoot` must cleanly walk up past the capsule boundary and locate the true sovereign project root.

### 1.4 Test Fixture Leakage in `tests/unit/store/load.test.ts`

In [`tests/unit/store/load.test.ts`](file:///Users/onurseckinsenoglu/repos/skills/tests/unit/store/load.test.ts#L60-L73):

```typescript
test("resolves a run relative to resolveCapsulesDir when targetPath does not exist directly", () => {
  const repo = findRepoRoot(); // ❌ Points to live host repo
  const runId = "test-load-relative-candidate-run";
  const capsulesDir = resolveCapsulesDir(repo); // ❌ Creates live .olt/capsules/
  const fullPath = join(capsulesDir, runId);
  mkdirSync(capsulesDir, { recursive: true });
  initRun(repo, runId, new TextEncoder().encode("relative body"), "file", true);
  try {
    const loaded = loadRun(runId); // ❌ Resolves against host repo
    expect(loaded.manifest.run_id).toBe(runId);
  } finally {
    rmSync(fullPath, { recursive: true, force: true });
  }
});
```

Because `repo` defaulted to `findRepoRoot()` without sandboxing, and `loadRun(runId)` inspected the host `.olt/capsules/`, test artifacts were written to the active repository. If an in-capsule `.olt` directory existed, it triggered the nested capsule creation bug.

---

## 2. Architectural Design & Boundary Contracts

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│             SOVEREIGN REPO ROOT & CAPSULE ISOLATION ARCHITECTURE            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Input: startDir (e.g. /repo/.olt/capsules/run-123/workspace/sub/) ]     │
│                                │                                            │
│                                ▼                                            │
│  [ Phase 1: Proactive Capsule Boundary Detection & Slicing ]                │
│    ┌──────────────────────────────────────────────────────────────────┐     │
│    │ isInsideCapsule(path) -> Checks for /.olt/capsules/, /.capsules/ │     │
│    │ stripCapsulePath(path) -> Extracts base root /repo               │     │
│    │ -> startDir is immediately clamped to enclosing root: /repo      │     │
│    └─────────────────────────────────┬────────────────────────────────┘     │
│                                      │                                      │
│                                      ▼                                      │
│  [ Phase 2: Upward Sovereign Root Traversal ]                               │
│    ┌──────────────────────────────────────────────────────────────────┐     │
│    │ while (current !== parent)                                       │     │
│    │   1. Skip if isInsideCapsule(current) [Defense-in-depth]         │     │
│    │   2. Skip if current.endsWith('/olt') or '/olt/scripts'          │     │
│    │   3. Check markers: .git, package.json, or sovereign .olt/       │     │
│    │   4. If matched -> RETURN sovereign root: /repo                  │     │
│    └─────────────────────────────────┬────────────────────────────────┘     │
│                                      │                                      │
│                                      ▼                                      │
│  [ Phase 3: Idempotent Directory Resolvers ]                                │
│    ┌──────────────────────────────────────────────────────────────────┐     │
│    │ resolveCapsulesDir(root):                                        │     │
│    │   • Normalizes input; if inside capsule, extracts repo root      │     │
│    │   • If root ends in /.olt/capsules -> returns root               │     │
│    │   • If root ends in /.olt -> returns join(root, "capsules")      │     │
│    │   • Otherwise -> returns join(findRepoRoot(root), ".olt", "caps")│     │
│    └─────────────────────────────────┬────────────────────────────────┘     │
│                                      │                                      │
│                                      ▼                                      │
│  [ Phase 4: Capsule Initialization Guard ]                                  │
│    ┌──────────────────────────────────────────────────────────────────┐     │
│    │ initRun(repoRoot, runId, ...):                                   │     │
│    │   • Asserts !isInsideCapsule(realpathSync(repoRoot))             │     │
│    │   • If inside capsule -> THROWS HarnessError("PATH_SAFETY", ...) │     │
│    │   • Enforces strictly flat: <repo>/.olt/capsules/<run_id>        │     │
│    └──────────────────────────────────────────────────────────────────┘     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Core Invariants:

1. **Sovereign Root Invariant:** `findRepoRoot(startDir)` must ALWAYS return the enclosing sovereign repository root, never a capsule directory, capsule subfolder, or in-capsule workspace.
2. **Capsule Non-Nesting Invariant:** Capsule run directories must strictly reside in a flat hierarchy directly under `<repo-root>/.olt/capsules/<run_id>`. No capsule workspace may contain a `.olt/capsules/` tree.
3. **Idempotent Directory Resolution:** `resolveCapsulesDir()` and `resolveOltDir()` must be idempotent. Passing a path that already ends in `.olt` or `.olt/capsules` must not produce duplicated path segments (`.olt/.olt` or `.olt/capsules/.olt/capsules`).
4. **Defensive `initRun` Interlock:** `initRun()` must throw `HarnessError("PATH_SAFETY", ...)` if `repoRoot` is inside an existing capsule workspace.
5. **Hermetic Test Sandboxing:** All unit and contract tests exercising capsule creation and run resolution must operate strictly within temporary isolated scratch directories (`scratchRoot(...)`), never modifying the live repository `.olt/capsules/`.

---

## 3. Exact TypeScript Signatures & AST Specifications

### 3.1 `olt/scripts/src/core/shared/paths.ts`

```typescript
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { HarnessError } from "../errors/harness-error.ts";

export const OLT_DIR_NAME = ".olt";
export const CAPSULES_DIR_NAME = "capsules";

/**
 * Returns true if the target path is located inside or is a capsule directory.
 * Matches `/.olt/capsules/`, `/.capsules/`, or paths ending with capsule directory identifiers.
 */
export function isInsideCapsule(targetPath: string): boolean {
  const normalized = resolve(targetPath).split(sep).join("/");
  return (
    normalized.includes("/.olt/capsules/") ||
    normalized.endsWith("/.olt/capsules") ||
    normalized.includes("/.capsules/") ||
    normalized.endsWith("/.capsules")
  );
}

/**
 * Extracts the enclosing sovereign repository root prefix if the path is inside a capsule.
 * Returns undefined if the path is not inside a capsule.
 */
export function stripCapsulePath(targetPath: string): string | undefined {
  const normalized = resolve(targetPath);
  const oltCapsulesPattern = `${sep}.olt${sep}capsules`;
  const oltCapsulesIdx = normalized.indexOf(oltCapsulesPattern);
  if (oltCapsulesIdx !== -1) {
    return normalized.slice(0, oltCapsulesIdx) || sep;
  }
  const dotCapsulesPattern = `${sep}.capsules`;
  const dotCapsulesIdx = normalized.indexOf(dotCapsulesPattern);
  if (dotCapsulesIdx !== -1) {
    return normalized.slice(0, dotCapsulesIdx) || sep;
  }
  return undefined;
}

/**
 * Deterministically locates the sovereign repository root.
 * Proactively strips capsule segments and walks up the directory hierarchy.
 */
export function findRepoRoot(startDir: string = process.cwd()): string {
  const resolvedStart = resolve(startDir);
  const stripped = stripCapsulePath(resolvedStart);
  let current = stripped ?? resolvedStart;

  while (true) {
    const isExcluded =
      current.endsWith("/olt/scripts") ||
      current.endsWith("/olt") ||
      current.endsWith("/.olt") ||
      isInsideCapsule(current);

    if (!isExcluded) {
      const hasOlt = existsSync(join(current, OLT_DIR_NAME));
      const hasGit = existsSync(join(current, ".git"));
      const hasPkg = existsSync(join(current, "package.json"));

      if (hasOlt || hasGit || hasPkg) {
        return current;
      }
    }

    const parent = resolve(current, "..");
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return stripped ?? resolvedStart;
}

/**
 * Idempotently resolves the canonical `.olt` directory for a repository.
 */
export function resolveOltDir(repoRoot?: string): string {
  let root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  if (isInsideCapsule(root)) {
    root = findRepoRoot(root);
  }
  if (root.endsWith(`${sep}${OLT_DIR_NAME}`)) {
    return root;
  }
  return join(root, OLT_DIR_NAME);
}

/**
 * Idempotently resolves the canonical `.olt/capsules` directory.
 */
export function resolveCapsulesDir(repoRoot?: string): string {
  let root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  if (isInsideCapsule(root)) {
    root = findRepoRoot(root);
  }
  const canonicalSuffix = `${sep}${OLT_DIR_NAME}${sep}${CAPSULES_DIR_NAME}`;
  if (root.endsWith(canonicalSuffix)) {
    return root;
  }
  if (root.endsWith(`${sep}${OLT_DIR_NAME}`)) {
    return join(root, CAPSULES_DIR_NAME);
  }
  return join(root, OLT_DIR_NAME, CAPSULES_DIR_NAME);
}
```

### 3.2 `olt/scripts/src/engine/store/index.ts`

```typescript
export function initRun(
  repoRoot: string,
  runId: string,
  prompt: Uint8Array,
  captureMode: string,
  sourceVerified: boolean,
  options: InitRunOptions = {},
): string {
  runId = normalizeRunId(runId);
  if (!RUN_ID_PATTERN.test(runId))
    throw new HarnessError("INVALID_ARGUMENT", "run_id must be a 1-128 character slug");
  if (!isCaptureMode(captureMode))
    throw new HarnessError("INVALID_ARGUMENT", `unsupported capture_mode: ${captureMode}`);
  if (!(prompt instanceof Uint8Array))
    throw new HarnessError("INVALID_ARGUMENT", "prompt must be bytes");
  if (typeof sourceVerified !== "boolean")
    throw new HarnessError("INVALID_ARGUMENT", "source_verified must be a bool");
  const assurance = captureAssurance(captureMode, sourceVerified);
  if (!existsSync(repoRoot) || !lstatSync(repoRoot).isDirectory())
    throw new HarnessError("INVALID_ARGUMENT", `repo_root must be a directory: ${repoRoot}`);

  const repo = realpathSync(repoRoot);
  if (isInsideCapsule(repo)) {
    throw new HarnessError(
      "PATH_SAFETY",
      `cannot initialize a capsule inside an existing capsule workspace: ${repo}`,
    );
  }

  const capsulesRoot = resolveCapsulesDir(repo);
  mkdirSync(capsulesRoot, { recursive: true, mode: 0o755 });
  ...
}
```

### 3.3 `olt/scripts/src/engine/store/index.ts`

```typescript
export interface LoadRunOptions extends StoreLimits {
  capsulesDir?: string;
  repoRoot?: string;
}

function loadRunFiles(
  runRoot: string,
  verify: boolean,
  options: LoadRunOptions,
  collectEvents: boolean,
): RunFiles {
  let targetPath = runRoot;
  if (!existsSync(targetPath)) {
    const baseCapsulesDir =
      options.capsulesDir ??
      (options.repoRoot ? resolveCapsulesDir(options.repoRoot) : resolveCapsulesDir());
    const candidate = join(baseCapsulesDir, runRoot);
    if (existsSync(candidate)) {
      targetPath = candidate;
    }
  }
  const rootStat = lstatSync(targetPath);
  ...
}
```

### 3.4 `olt/scripts/src/policy/repo-policy.ts` & Diagnostics Reporting

```typescript
export interface PolicyInspectionResult {
  readonly status: "valid_custom" | "invalid_custom" | "auto_detected";
  readonly policy: RepoPolicy;
  readonly filePath?: string;
  readonly error?: string;
}

export function inspectRepoPolicy(repoRoot?: string, customPath?: string): PolicyInspectionResult {
  const filePath = resolvePolicyPath(repoRoot, customPath);
  if (!existsSync(filePath)) {
    return {
      status: "auto_detected",
      policy: generateDefaultRepoPolicy(repoRoot),
    };
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const policy = validateRepoPolicy(parsed);
    return {
      status: "valid_custom",
      policy,
      filePath,
    };
  } catch (error) {
    return {
      status: "invalid_custom",
      policy: generateDefaultRepoPolicy(repoRoot),
      filePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
```

In `olt/scripts/src/reporting/doctor.ts`:

- Include `policyInspection` in `runDoctor` return payload.
- Flag `invalid_custom` policy files as an explicit doctor issue (`"policy: .olt/policy.json is corrupted or invalid: <error>"`).

---

## 4. Work Breakdown & Atomic Implementation Tasks

### Task 1: Harden Shared Path Resolvers in `olt/scripts/src/core/shared/paths.ts`

- [ ] Export `isInsideCapsule(targetPath: string): boolean`.
- [ ] Export `stripCapsulePath(targetPath: string): string | undefined`.
- [ ] Refactor `findRepoRoot(startDir)`:
  - Proactively clamp `current` to `stripCapsulePath(startDir)`.
  - In the upward traversal loop, ignore directories matching `isInsideCapsule(current)`.
  - Exclude `.olt`, `olt`, and `olt/scripts` suffix matches.
  - Return the true sovereign repository root deterministically.
- [ ] Refactor `resolveCapsulesDir(repoRoot?)` and `resolveOltDir(repoRoot?)`:
  - Enforce idempotency on inputs ending in `/.olt` or `/.olt/capsules`.

### Task 2: Implement Capsule Nesting Guard in `olt/scripts/src/engine/store/index.ts`

- [ ] In `initRun(repoRoot, runId, ...)`:
  - Import `isInsideCapsule` from `../../core/shared/paths.ts`.
  - Add assertion: `if (isInsideCapsule(repo)) throw new HarnessError("PATH_SAFETY", "cannot initialize a capsule inside an existing capsule workspace: " + repo);`.
  - Ensure error code is strictly `"PATH_SAFETY"`.

### Task 3: Enhance Run Loader Isolation in `olt/scripts/src/engine/store/index.ts`

- [ ] Update `loadRunFiles(runRoot, verify, options, collectEvents)`:
  - Support `options.capsulesDir` and `options.repoRoot` in candidate path resolution.
  - Export `LoadRunOptions` interface extending `StoreLimits`.

### Task 4: Policy Inspection & Doctor Diagnostics in `repo-policy.ts` & `doctor.ts`

- [ ] In `olt/scripts/src/policy/repo-policy.ts`:
  - Export `inspectRepoPolicy(repoRoot?, customPath?)`.
- [ ] In `olt/scripts/src/reporting/doctor.ts`:
  - Call `inspectRepoPolicy(repository)` during `runDoctor`.
  - If `status === "invalid_custom"`, add diagnostic issue to doctor report.
  - Expose `policy_status` in doctor output object.

### Task 5: Hermetic Sandboxing for `tests/unit/store/load.test.ts` & Working Tree Purge

- [ ] Refactor `tests/unit/store/load.test.ts` (`"resolves a run relative to resolveCapsulesDir..."`):
  - Use `scratchRoot(import.meta.path, "relative-load-test")` as `repo`.
  - Pass `{ repoRoot: repo }` or test against isolated sandbox capsules directory.
  - Guarantee zero writes to live `.olt/capsules/`.
- [ ] Purge any legacy stray directories (e.g. `.olt/capsules/.olt`) from the repository working tree.

### Task 6: Comprehensive Regression Test Suite

- [ ] Update `tests/unit/contracts/shared-paths.test.ts`:
  - Add test cases for `isInsideCapsule` with positive and negative path assertions.
  - Add test cases for `stripCapsulePath` across `.olt/capsules`, `.capsules`, and standard paths.
  - Add test cases for `findRepoRoot` resolving from inside `.olt/capsules/<run_id>`, `.olt/capsules/<run_id>/.olt`, deeply nested workspaces, and git worktrees.
  - Add test cases for `resolveCapsulesDir` and `resolveOltDir` idempotency.
- [ ] Add unit test in `tests/unit/store/capsule.test.ts`:
  - Assert that `initRun` throws `HarnessError("PATH_SAFETY", ...)` when `repoRoot` is inside a capsule.

---

## 5. Comprehensive Regression Test Matrix

| #   | Test Scenario                     | Input Path / Fixture                                 | Expected Outcome                            | Target Verification File                    |
| :-- | :-------------------------------- | :--------------------------------------------------- | :------------------------------------------ | :------------------------------------------ |
| 1   | Standard Repo Root                | `/repo/src/core/paths.ts`                            | `/repo`                                     | `tests/unit/contracts/shared-paths.test.ts` |
| 2   | Inside Capsule Direct             | `/repo/.olt/capsules/run-101`                        | `/repo`                                     | `tests/unit/contracts/shared-paths.test.ts` |
| 3   | Inside Capsule Subdirectory       | `/repo/.olt/capsules/run-101/workspace/deep/pkg`     | `/repo`                                     | `tests/unit/contracts/shared-paths.test.ts` |
| 4   | In-Capsule `.olt/` Folder         | `/repo/.olt/capsules/run-101/.olt/`                  | `/repo`                                     | `tests/unit/contracts/shared-paths.test.ts` |
| 5   | In-Capsule `package.json`         | `/repo/.olt/capsules/run-101/workspace/package.json` | `/repo`                                     | `tests/unit/contracts/shared-paths.test.ts` |
| 6   | Alternative `.capsules/` Path     | `/repo/.capsules/run-202/task/`                      | `/repo`                                     | `tests/unit/contracts/shared-paths.test.ts` |
| 7   | Git Worktree (`.git` file)        | `/repo/worktree-a/sub/` (with `.git` file)           | `/repo/worktree-a`                          | `tests/unit/contracts/shared-paths.test.ts` |
| 8   | Normal Subfolder Named `capsules` | `/repo/src/capsules/module.ts`                       | `/repo` (`isInsideCapsule` returns `false`) | `tests/unit/contracts/shared-paths.test.ts` |
| 9   | Idempotent `resolveCapsulesDir`   | `resolveCapsulesDir("/repo/.olt/capsules")`          | `/repo/.olt/capsules` (No duplication)      | `tests/unit/contracts/shared-paths.test.ts` |
| 10  | Idempotent `resolveOltDir`        | `resolveOltDir("/repo/.olt")`                        | `/repo/.olt` (No duplication)               | `tests/unit/contracts/shared-paths.test.ts` |
| 11  | `initRun` Nesting Guard           | `initRun("/repo/.olt/capsules/run-1", "child", ...)` | Throws `HarnessError("PATH_SAFETY")`        | `tests/unit/store/capsule.test.ts`          |
| 12  | Sandboxed Relative Run Load       | `loadRun(runId, true, { repoRoot: scratchRepo })`    | Loads run without touching host `.olt/`     | `tests/unit/store/load.test.ts`             |
| 13  | Policy Health Diagnostic          | Malformed JSON in `.olt/policy.json`                 | `doctor` reports `invalid_custom` issue     | `tests/unit/policy/repo-policy.test.ts`     |

---

## 6. Zero-Tolerance Quality Gates & Verification Evidence

| Quality Gate                      | Command / Verification                                                                                 | Target Acceptance Criteria                           |
| :-------------------------------- | :----------------------------------------------------------------------------------------------------- | :--------------------------------------------------- |
| **Path Traversal Contract Tests** | `bun test tests/unit/contracts/shared-paths.test.ts`                                                   | 100% pass, covering all nesting & worktree scenarios |
| **Shared Path Tests**             | `bun test tests/unit/shared/paths.test.ts`                                                             | 100% pass                                            |
| **Store Suite Tests**             | `bun test tests/unit/store/`                                                                           | 100% pass across all store lifecycle operations      |
| **Monorepo Typecheck**            | `bun run typecheck` (`tsc -p tsconfig.json --noEmit`)                                                  | Exactly 0 type errors, 0 `any` violations            |
| **Clean Working Tree Audit**      | `find .olt/capsules -mindepth 2 -name ".olt"`                                                          | Exactly 0 nested `.olt` directories on disk          |
| **Code Formatting**               | `bun x oxfmt --check docs/planning/27-capsule-nesting-guard-and-repo-root-traversal-isolation/PLAN.md` | Clean formatting pass                                |
