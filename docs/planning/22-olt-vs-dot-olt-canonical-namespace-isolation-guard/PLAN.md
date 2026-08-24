# Plan 22: `olt/` vs `.olt/` Canonical Namespace & Directory Isolation Guard

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mechanically enforce strict architectural namespace separation between the skill source code repository tree (`olt/`) and the runtime orchestration ledger directory (`.olt/`), preventing agents from polluting the source tree with runtime JSON artifacts (e.g. `olt/checklist.json`, `olt/completed-tasks.jsonl`, `olt/defects.jsonl`) or storing source code in runtime ledgers.

---

## 1. Architectural Overview & Four-Namespace Model

The skills architecture establishes four strictly bounded filesystem namespaces with distinct lifecycle and persistence semantics:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       CANONICAL NAMESPACE TAXONOMY                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. [ olt/ ] — Skill Source & Extension Tree (Committed)                   │
│     • Exclusively reserved for skill source files: .ts, .md, .yaml, json   │
│     • Subtrees: olt/scripts/, olt/agents/, olt/checklists/, olt/references │
│     • PROHIBITED: Runtime JSON ledgers, dynamic dumps, scratch logs        │
│     • VIOLATION: [NAMESPACE_POLLUTION_VIOLATION]                           │
│                                                                             │
│  2. [ .olt/ ] — Project Governance & Runtime Ledgers (Committed / Dynamic) │
│     • Exclusively reserved for governance ledgers and runtime state        │
│     • Files: policy.json, backlog.jsonl, completed-tasks.jsonl,            │
│       defects.jsonl, completed-defects.jsonl, telemetry.jsonl,             │
│       memory.json, watchdogs.json                                          │
│     • PROHIBITED: Application source code trees outside hooks/scripts       │
│                                                                             │
│  3. [ capsules/ ] (or .olt/capsules/) — Ephemeral Run Workspaces            │
│     • Per-run and per-task isolated execution worktrees and evidence       │
│     • Gitignored runtime artifacts                                         │
│                                                                             │
│  4. [ scratch/ ] (or .olt/scratch/) — Temporary Execution & Debug Scaffolding│
│     • Ephemeral scripts, one-off patches, temporary debug artifacts        │
│     • Enforced by RootDirectoryHygieneGuard (Axiom 30)                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Namespace Invariants & Contracts

1. **`olt/` (Without Dot — Source Tree):**
   - Contains immutable/versioned skill source assets: `olt/AGENTS.md`, `olt/SKILL.md`, `olt/.skillignore`, `olt/scripts/`, `olt/agents/`, `olt/checklists/`, `olt/references/`.
   - Any attempt to write loose runtime state files (`backlog.jsonl`, `defects.jsonl`, `completed-tasks.jsonl`, `completed-defects.jsonl`, `telemetry.jsonl`, `memory.json`, `watchdogs.json`, `checklist.json`, `state.json`, `events.jsonl`) directly into `olt/` is mechanically blocked.
2. **`.olt/` (With Dot — Governance & Runtime State):**
   - Contains project governance policies and append-only runtime ledgers.
   - Path resolution across all harness commands must resolve exclusively against `.olt/` via `OLT_DIR_NAME = ".olt"`.
3. **`capsules/` & `scratch/`:**
   - Isolated from source directories and governed by `RootDirectoryHygieneGuard` to prevent workspace leakage.

---

## 2. Implementation Status & Audit Matrix

| Component                               | Target Location                                                    | Current Codebase Status    | Evidence / Active Artifact                                                                                                                                                                                                    |
| :-------------------------------------- | :----------------------------------------------------------------- | :------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Path Resolution Layer**               | `olt/scripts/src/core/shared/paths.ts`                             | **Fully Implemented**      | `OLT_DIR_NAME = ".olt"` strictly resolves `resolveBacklogPath()`, `resolveDefectsPath()`, `resolveTelemetryPath()`, `resolveMemoryPath()`, `resolveWatchdogsPath()`. Verified by `tests/unit/contracts/shared-paths.test.ts`. |
| **Root Scratch Guard**                  | `olt/scripts/src/authority/root-hygiene-guard.ts`                  | **Fully Implemented**      | `RootDirectoryHygieneGuard.assertAllowedWritePath(...)` blocks ad-hoc scratch scripts in root. Verified by `tests/unit/authority/root-hygiene-guard.test.ts`.                                                                 |
| **Mechanical Namespace Guard**          | `olt/scripts/src/authority/namespace-isolation-guard.ts`           | **Pending Implementation** | Class `NamespaceIsolationGuard` and unit tests `tests/unit/authority/namespace-isolation-guard.test.ts` to be implemented.                                                                                                    |
| **Core I/O & Pre-Command Interception** | `olt/scripts/src/core/paths.ts` & `olt/scripts/src/cli/execute.ts` | **Pending Integration**    | Hook `NamespaceIsolationGuard.assertValidPath(...)` into path resolution, durable writes, and CLI execution middleware.                                                                                                       |

---

## 3. Global Constraints & Tech Stack

- **Tech Stack:** TypeScript, Bun, Node.js path primitives (`isAbsolute`, `relative`, `resolve`), OLT Authority Engine.
- **Spec:** `AGENTS.md` (Axiom 27: Canonical `olt/` Repository Directory & Persistent Governance, Axiom 30: Root Directory Hygiene & Scratch Confinement).
- **Type Safety:** 0 `any` annotations, strict `HarnessError("PATH_SAFETY", ...)` error codes.
- **Zero Performance Overhead:** In-memory path normalization and Set-based matching.

---

## 4. Implementation Tasks

### Task 1: Implement `NamespaceIsolationGuard` in `olt/scripts/src/authority/namespace-isolation-guard.ts`

**Files:**

- Create: `olt/scripts/src/authority/namespace-isolation-guard.ts`
- Test: `tests/unit/authority/namespace-isolation-guard.test.ts`

**Interfaces & Types:**

```typescript
export class NamespaceIsolationGuard {
  public static assertValidPath(repoRoot: string, targetPath: string): void;
  public static isRuntimeLedgerFile(filename: string): boolean;
}
```

- [ ] **Step 1: Write failing unit test for `NamespaceIsolationGuard`**

```typescript
import { describe, it, expect } from "bun:test";
import { NamespaceIsolationGuard } from "../../../olt/scripts/src/authority/namespace-isolation-guard.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";

describe("NamespaceIsolationGuard", () => {
  const repoRoot = "/Users/foo/repos/skills";

  it("blocks writing runtime JSON state directly inside olt/ source tree", () => {
    const forbiddenOltFiles = [
      "/Users/foo/repos/skills/olt/checklist.json",
      "/Users/foo/repos/skills/olt/completed-tasks.jsonl",
      "/Users/foo/repos/skills/olt/backlog.jsonl",
      "/Users/foo/repos/skills/olt/defects.jsonl",
      "/Users/foo/repos/skills/olt/completed-defects.jsonl",
      "/Users/foo/repos/skills/olt/telemetry.jsonl",
      "/Users/foo/repos/skills/olt/memory.json",
      "/Users/foo/repos/skills/olt/watchdogs.json",
      "/Users/foo/repos/skills/olt/state.json",
      "/Users/foo/repos/skills/olt/events.jsonl",
    ];

    for (const target of forbiddenOltFiles) {
      expect(() => {
        NamespaceIsolationGuard.assertValidPath(repoRoot, target);
      }).toThrow(HarnessError);

      try {
        NamespaceIsolationGuard.assertValidPath(repoRoot, target);
      } catch (err: unknown) {
        expect(err instanceof HarnessError).toBe(true);
        expect((err as HarnessError).code).toBe("PATH_SAFETY");
        expect((err as HarnessError).message).toContain("[NAMESPACE_POLLUTION_VIOLATION]");
      }
    }
  });

  it("allows writing valid source, checklist definition, and documentation files in olt/", () => {
    const allowedOltFiles = [
      "/Users/foo/repos/skills/olt/scripts/src/authority/namespace-isolation-guard.ts",
      "/Users/foo/repos/skills/olt/SKILL.md",
      "/Users/foo/repos/skills/olt/AGENTS.md",
      "/Users/foo/repos/skills/olt/checklists/quality.yaml",
      "/Users/foo/repos/skills/olt/references/cli-capabilities.md",
    ];

    for (const target of allowedOltFiles) {
      expect(() => {
        NamespaceIsolationGuard.assertValidPath(repoRoot, target);
      }).not.toThrow();
    }
  });

  it("allows writing valid runtime ledgers and governance files in .olt/", () => {
    const validDotOltFiles = [
      "/Users/foo/repos/skills/.olt/backlog.jsonl",
      "/Users/foo/repos/skills/.olt/defects.jsonl",
      "/Users/foo/repos/skills/.olt/completed-tasks.jsonl",
      "/Users/foo/repos/skills/.olt/telemetry.jsonl",
      "/Users/foo/repos/skills/.olt/memory.json",
      "/Users/foo/repos/skills/.olt/policy.json",
      "/Users/foo/repos/skills/.olt/watchdogs.json",
      "/Users/foo/repos/skills/.olt/capsules/run-1/task-1/state.json",
    ];

    for (const target of validDotOltFiles) {
      expect(() => {
        NamespaceIsolationGuard.assertValidPath(repoRoot, target);
      }).not.toThrow();
    }
  });

  it("allows writing inside scratch/ and .olt/scratch/", () => {
    expect(() => {
      NamespaceIsolationGuard.assertValidPath(repoRoot, "/Users/foo/repos/skills/scratch/test.ts");
    }).not.toThrow();
    expect(() => {
      NamespaceIsolationGuard.assertValidPath(
        repoRoot,
        "/Users/foo/repos/skills/.olt/scratch/debug.log",
      );
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `NamespaceIsolationGuard` in `olt/scripts/src/authority/namespace-isolation-guard.ts`**

```typescript
import { isAbsolute, relative, basename } from "node:path";
import { HarnessError } from "../core/errors/harness-error.ts";

const RUNTIME_LEDGER_BASENAMES = new Set([
  "backlog.jsonl",
  "completed-tasks.jsonl",
  "defects.jsonl",
  "completed-defects.jsonl",
  "telemetry.jsonl",
  "memory.json",
  "watchdogs.json",
  "checklist.json",
  "state.json",
  "events.jsonl",
]);

export class NamespaceIsolationGuard {
  public static isRuntimeLedgerFile(filename: string): boolean {
    const base = basename(filename).toLowerCase();
    return RUNTIME_LEDGER_BASENAMES.has(base);
  }

  public static assertValidPath(repoRoot: string, targetPath: string): void {
    const absPath = isAbsolute(targetPath) ? targetPath : `${repoRoot}/${targetPath}`;
    const rel = relative(repoRoot, absPath).replace(/\\/gu, "/");

    // Check if target is inside the olt/ (without dot) tree
    if (rel === "olt" || rel.startsWith("olt/")) {
      const fileName = basename(rel);
      if (NamespaceIsolationGuard.isRuntimeLedgerFile(fileName)) {
        throw new HarnessError(
          "PATH_SAFETY",
          `[NAMESPACE_POLLUTION_VIOLATION] Cannot write runtime ledger artifact '${rel}' inside 'olt/'. Runtime state must reside in '.olt/' or 'capsules/'.`,
        );
      }
    }
  }
}
```

- [ ] **Step 4: Run unit test to verify it passes**
- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/authority/namespace-isolation-guard.ts tests/unit/authority/namespace-isolation-guard.test.ts
git commit -m "feat(authority): implement NamespaceIsolationGuard for strict olt vs .olt separation"
```

---

### Task 2: Integrate `NamespaceIsolationGuard` into Core Path Resolution & Durable Writes

**Files:**

- Modify: `olt/scripts/src/core/paths.ts`
- Modify: `olt/scripts/src/core/durable-write.ts`
- Test: `tests/unit/core/paths.test.ts` (or `tests/unit/contracts/shared-paths.test.ts`)

- [ ] **Step 1: Write integration unit test verifying write paths trigger `NamespaceIsolationGuard`**
- [ ] **Step 2: Run test to verify failure**
- [ ] **Step 3: Update `safeRepoPath` in `olt/scripts/src/core/paths.ts` to call `NamespaceIsolationGuard.assertValidPath`**
- [ ] **Step 4: Update `atomicWriteBytes` / `atomicWriteJson` in `olt/scripts/src/core/durable-write.ts` to guard destination paths**
- [ ] **Step 5: Run tests to verify they pass**
- [ ] **Step 6: Commit**

```bash
git add olt/scripts/src/core/paths.ts olt/scripts/src/core/durable-write.ts
git commit -m "feat(core): integrate NamespaceIsolationGuard into safeRepoPath and durable writes"
```

---

### Task 3: Pre-Command Middleware Interception in CLI Engine

**Files:**

- Modify: `olt/scripts/src/cli/execute.ts`
- Test: `tests/unit/cli/execute.test.ts`

- [ ] **Step 1: Write unit test verifying CLI command flags containing path arguments validate against `NamespaceIsolationGuard`**
- [ ] **Step 2: Run test to verify failure**
- [ ] **Step 3: Hook `NamespaceIsolationGuard.assertValidPath` into `execute.ts` pre-command argument validation loop**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/cli/execute.ts
git commit -m "feat(cli): enforce NamespaceIsolationGuard during CLI pre-command execution"
```

---

### Task 4: End-to-End Verification & Global Skill Sync

- [ ] **Step 1:** Run full test suite for authority and core paths:
  ```bash
  bun test tests/unit/authority/namespace-isolation-guard.test.ts
  bun test tests/unit/authority/root-hygiene-guard.test.ts
  bun test tests/unit/contracts/shared-paths.test.ts
  ```
- [ ] **Step 2:** Run repository typecheck: `bun run typecheck`
- [ ] **Step 3:** Synchronize global skill: `bun scripts/sync-global.ts`
- [ ] **Step 4:** Verify synchronized skill tree in `~/.agents/skills/olt/` reflects active namespace guards.
