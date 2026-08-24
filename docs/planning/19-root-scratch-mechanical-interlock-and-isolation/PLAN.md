# Plan 19: Root Scratch Mechanical Interlock & Directory Hygiene Enforcement

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mechanically prevent agents from writing, dumping, or leaving temporary `.ts`, `.cjs`, `.js`, `.py`, `.json`, or `.log` scratch files in the repository root directory, enforcing that all temporary operations are strictly confined to `scratch/` or `.olt/scratch/`.

**Architecture:** Implement a `RootDirectoryHygieneGuard` in `olt/scripts/src/authority/` and integrate it into pre-command execution and pre-commit hooks. If an agent attempts to create a file directly under the repository root (outside allowed tracked files like `package.json`, `tsconfig.json`, `AGENTS.md`, `README.md`), the action is rejected with `ROOT_HYGIENE_VIOLATION`.

**Tech Stack:** TypeScript, Bun, filesystem path normalization, OLT Authority Engine.

**Spec:** `AGENTS.md` (Axiom 30: Root Directory Hygiene & Scratch Confinement).

## Global Constraints

- Writing temporary scripts in repository root is strictly prohibited.
- `scratch/` and `.scratch/` directories are permanently gitignored.
- 0 `any` annotations.

---

### Task 1: Implement `RootDirectoryHygieneGuard` in `olt/scripts/src/authority/`

**Files:**

- Create: `olt/scripts/src/authority/root-hygiene-guard.ts`
- Test: `tests/unit/authority/root-hygiene-guard.test.ts`

**Interfaces:**

- Consumes: `filePath: string`, `repoRoot: string`.
- Produces: `export class RootDirectoryHygieneGuard { public static assertAllowedWritePath(repoRoot: string, targetPath: string): void; }`

- [ ] **Step 1: Write the failing unit test**

```typescript
import { describe, it, expect } from "bun:test";
import { RootDirectoryHygieneGuard } from "../../../olt/scripts/src/authority/root-hygiene-guard.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";

describe("RootDirectoryHygieneGuard", () => {
  const repoRoot = "/Users/foo/repos/skills";

  it("blocks writing ad-hoc scratch scripts in root", () => {
    expect(() => {
      RootDirectoryHygieneGuard.assertAllowedWritePath(
        repoRoot,
        "/Users/foo/repos/skills/fix_state.ts",
      );
    }).toThrow(HarnessError);

    expect(() => {
      RootDirectoryHygieneGuard.assertAllowedWritePath(
        repoRoot,
        "/Users/foo/repos/skills/patch.cjs",
      );
    }).toThrow(HarnessError);
  });

  it("allows writing inside scratch/ directory", () => {
    expect(() => {
      RootDirectoryHygieneGuard.assertAllowedWritePath(
        repoRoot,
        "/Users/foo/repos/skills/scratch/fix_state.ts",
      );
    }).not.toThrow();
  });

  it("allows writing recognized project root configuration files", () => {
    expect(() => {
      RootDirectoryHygieneGuard.assertAllowedWritePath(
        repoRoot,
        "/Users/foo/repos/skills/package.json",
      );
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/authority/root-hygiene-guard.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `RootDirectoryHygieneGuard`**

```typescript
import { isAbsolute, relative, dirname } from "node:path";
import { HarnessError } from "../core/errors/harness-error.ts";

const ALLOWED_ROOT_FILES = new Set([
  "package.json",
  "tsconfig.json",
  "AGENTS.md",
  "README.md",
  "GEMINI.md",
  "lefthook.yml",
  ".gitignore",
  "bun.lock",
  "bun.lockb",
]);

export class RootDirectoryHygieneGuard {
  public static assertAllowedWritePath(repoRoot: string, targetPath: string): void {
    const absPath = isAbsolute(targetPath) ? targetPath : `${repoRoot}/${targetPath}`;
    const rel = relative(repoRoot, absPath);

    // If file is directly in root (no directory slashes)
    if (!rel.includes("/") && !rel.includes("\\")) {
      if (!ALLOWED_ROOT_FILES.has(rel)) {
        throw new HarnessError(
          "PATH_SAFETY",
          `[ROOT_HYGIENE_VIOLATION] Cannot create loose scratch file '${rel}' in repository root. All temporary scripts, patches, and logs MUST reside in 'scratch/' or '.olt/scratch/'.`,
        );
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/authority/root-hygiene-guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/authority/root-hygiene-guard.ts tests/unit/authority/root-hygiene-guard.test.ts
git commit -m "feat(authority): implement RootDirectoryHygieneGuard to block root scratch pollution"
```
