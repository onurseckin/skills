# Plan 22: `olt/` vs `.olt/` Canonical Namespace & Directory Isolation Guard

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mechanically enforce strict architectural namespace separation between the skill source code repository tree (`olt/`) and the runtime orchestration ledger directory (`.olt/`), preventing agents from polluting the source tree with runtime JSON artifacts (e.g. `olt/checklist.json`, `olt/completed-tasks.jsonl`) or storing source code in runtime ledgers.

**Architecture:** Implement a `NamespaceIsolationGuard` under `olt/scripts/src/authority/namespace-isolation-guard.ts` integrated into pre-command middleware (`execute.ts`) and pre-commit checks:

1. `olt/` (WITHOUT DOT): Exclusively reserved for skill source files (`.ts`, `.md`, `.yaml`, `package.json`, `tsconfig.json`). Any attempt to write loose runtime state, generated JSON dumps, or scratch logs directly under `olt/` throws `[NAMESPACE_POLLUTION_VIOLATION]`.
2. `.olt/` (WITH DOT): Exclusively reserved for runtime state ledgers (`backlog.jsonl`, `defects.jsonl`, `memory.json`, `telemetry.jsonl`, `completed-tasks.jsonl`, `.sessions/`, `capsules/`).
3. `scratch/`: Exclusively reserved for temporary scripts and one-off artifacts.

**Tech Stack:** TypeScript, Bun, path normalization, OLT Authority Engine.

**Spec:** `AGENTS.md` (Axiom 27: Canonical `olt/` Repository Directory & Persistent Governance).

## Global Constraints

- No runtime generated JSON state or session data may ever be written inside `olt/` (e.g., `olt/checklist.json`, `olt/state.json` are strictly forbidden).
- All runtime ledgers must reside strictly within `.olt/`.
- 0 `any` annotations.

---

### Task 1: Implement `NamespaceIsolationGuard` in `olt/scripts/src/authority/namespace-isolation-guard.ts`

**Files:**

- Create: `olt/scripts/src/authority/namespace-isolation-guard.ts`
- Test: `tests/unit/authority/namespace-isolation-guard.test.ts`

**Interfaces:**

- Consumes: `repoRoot: string`, `targetPath: string`.
- Produces: `export class NamespaceIsolationGuard { public static assertValidPath(repoRoot: string, targetPath: string): void; }`

- [ ] **Step 1: Write failing unit test for `NamespaceIsolationGuard`**

```typescript
import { describe, it, expect } from "bun:test";
import { NamespaceIsolationGuard } from "../../../olt/scripts/src/authority/namespace-isolation-guard.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";

describe("NamespaceIsolationGuard", () => {
  const repoRoot = "/Users/foo/repos/skills";

  it("blocks writing runtime JSON state directly inside olt/ source tree", () => {
    expect(() => {
      NamespaceIsolationGuard.assertValidPath(
        repoRoot,
        "/Users/foo/repos/skills/olt/checklist.json",
      );
    }).toThrow(HarnessError);

    expect(() => {
      NamespaceIsolationGuard.assertValidPath(
        repoRoot,
        "/Users/foo/repos/skills/olt/completed-tasks.jsonl",
      );
    }).toThrow(HarnessError);
  });

  it("allows writing valid source and documentation files in olt/", () => {
    expect(() => {
      NamespaceIsolationGuard.assertValidPath(
        repoRoot,
        "/Users/foo/repos/skills/olt/scripts/src/authority/guard.ts",
      );
    }).not.toThrow();

    expect(() => {
      NamespaceIsolationGuard.assertValidPath(
        repoRoot,
        "/Users/foo/repos/skills/olt/roles/mind.md",
      );
    }).not.toThrow();
  });

  it("allows writing valid runtime ledgers in .olt/", () => {
    expect(() => {
      NamespaceIsolationGuard.assertValidPath(
        repoRoot,
        "/Users/foo/repos/skills/.olt/backlog.jsonl",
      );
    }).not.toThrow();

    expect(() => {
      NamespaceIsolationGuard.assertValidPath(
        repoRoot,
        "/Users/foo/repos/skills/.olt/capsules/run-1/state.json",
      );
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/authority/namespace-isolation-guard.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `NamespaceIsolationGuard`**

```typescript
import { isAbsolute, relative } from "node:path";
import { HarnessError } from "../core/errors/harness-error.ts";

const FORBIDDEN_OLT_SOURCE_EXTENSIONS = new Set(["jsonl", "log", "tmp"]);

export class NamespaceIsolationGuard {
  public static assertValidPath(repoRoot: string, targetPath: string): void {
    const absPath = isAbsolute(targetPath) ? targetPath : `${repoRoot}/${targetPath}`;
    const rel = relative(repoRoot, absPath);

    // Rule 1: olt/ is exclusively for skill source code
    if (rel.startsWith("olt/") || rel.startsWith("olt\\")) {
      const subPath = rel.slice(4);

      // If directly inside olt/ root (e.g. olt/checklist.json, olt/state.json)
      if (!subPath.includes("/") && !subPath.includes("\\")) {
        if (subPath.endsWith(".json") || subPath.endsWith(".jsonl") || subPath.endsWith(".log")) {
          throw new HarnessError(
            "PATH_SAFETY",
            `[NAMESPACE_POLLUTION_VIOLATION] Cannot write runtime artifact '${rel}' inside skill source tree 'olt/'. Runtime ledgers belong in '.olt/' and temporary files belong in 'scratch/'.`,
          );
        }
      }

      // Check extensions
      const ext = rel.split(".").pop()?.toLowerCase();
      if (ext && FORBIDDEN_OLT_SOURCE_EXTENSIONS.has(ext)) {
        throw new HarnessError(
          "PATH_SAFETY",
          `[NAMESPACE_POLLUTION_VIOLATION] Cannot write runtime ledger or log '${rel}' in 'olt/'. Use '.olt/' for runtime state.`,
        );
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/authority/namespace-isolation-guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/authority/namespace-isolation-guard.ts tests/unit/authority/namespace-isolation-guard.test.ts
git commit -m "feat(authority): implement NamespaceIsolationGuard for strict olt vs .olt separation"
```
