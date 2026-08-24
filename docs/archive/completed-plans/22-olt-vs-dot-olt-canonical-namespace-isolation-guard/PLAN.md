# Plan 22: `olt/` vs `.olt/` Canonical Namespace & Directory Isolation Guard

> **Status:** Completed & Authoritative (Unified Plan & Post-Implementation Analysis)  
> **Spec Reference:** `AGENTS.md` (Axiom 27: Canonical `olt/` Repository Directory & Persistent Governance, Axiom 30: Root Directory Hygiene & Scratch Confinement, Axiom 3: Disjoint Write Scope Invariant)  
> **Corpus / Subsystem:** `olt/scripts/src/core/shared/paths.ts`, `olt/scripts/src/authority/root-hygiene-guard.ts`, `olt/scripts/src/core/paths.ts`, `scripts/sync-global.ts`, `tests/unit/contracts/shared-paths.test.ts`, `tests/unit/authority/root-hygiene-guard.test.ts`

---

## 1. Executive Summary & Four-Namespace Model

The skills architecture establishes four strictly bounded filesystem namespaces with distinct lifecycle, persistence, and distribution semantics:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       CANONICAL NAMESPACE TAXONOMY                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. [ olt/ ] — Skill Source & Extension Tree (Committed & Globally Synced)  │
│     • Exclusively reserved for skill source files: .ts, .md, .yaml, json   │
│     • Subtrees: olt/scripts/, olt/agents/, olt/checklists/, olt/references, │
│       olt/roles/                                                            │
│     • PROHIBITED: Runtime JSON ledgers, dynamic dumps, scratch logs        │
│     • VIOLATION: [NAMESPACE_POLLUTION_VIOLATION]                           │
│                                                                             │
│  2. [ .olt/ ] — Project Governance & Runtime Ledgers (Committed / Tracked) │
│     • Exclusively reserved for governance policies and append-only ledgers  │
│     • Files: policy.json, backlog.jsonl, completed-tasks.jsonl,            │
│       defects.jsonl, completed-defects.jsonl, telemetry.jsonl,             │
│       memory.json, watchdogs.json                                          │
│     • PROHIBITED: Application source code trees outside hooks/scripts       │
│                                                                             │
│  3. [ .olt/capsules/ ] — Ephemeral Run Workspaces (Gitignored)              │
│     • Per-run and per-task isolated execution worktrees and evidence       │
│     • Flat hierarchy: .olt/capsules/<run_id>/ (Plan 27 isolation)          │
│                                                                             │
│  4. [ .olt/scratch/ ] (or scratch/) — Temporary Execution & Debug Scaffolding│
│     • Ephemeral scripts, one-off patches, temporary debug artifacts        │
│     • Enforced by RootDirectoryHygieneGuard (Axiom 30)                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Namespace Invariants & Architectural Separation Mechanisms

1. **`olt/` (Without Dot — Skill Source Tree):**
   - Contains immutable/versioned skill source assets: `olt/AGENTS.md`, `olt/SKILL.md`, `olt/.skillignore`, `olt/scripts/`, `olt/agents/`, `olt/checklists/`, `olt/references/`, `olt/roles/`.
   - Global packaging in [`scripts/sync-global.ts`](file:///Users/onurseckinsenoglu/repos/skills/scripts/sync-global.ts) deploys strictly the `olt/` assets to `~/.agents/skills/olt/`, completely isolating runtime governance from skill distribution.
2. **`.olt/` (With Dot — Governance & Runtime State):**
   - Contains repository governance policies and append-only runtime ledgers.
   - Path resolution across all harness commands resolves exclusively against `.olt/` via `OLT_DIR_NAME = ".olt"` in [`olt/scripts/src/core/shared/paths.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/core/shared/paths.ts).
   - Functions `resolveBacklogPath()`, `resolveDefectsPath()`, `resolveCompletedTasksPath()`, `resolveCompletedDefectsPath()`, `resolveTelemetryPath()`, `resolveMemoryPath()`, `resolveWatchdogsPath()`, and `resolvePolicyPath()` strictly target `.olt/`.
3. **Upward Traversal & Sovereign Root Isolation:**
   - `findRepoRoot()` in [`olt/scripts/src/core/shared/paths.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/core/shared/paths.ts) explicitly ignores `olt`, `olt/scripts`, and `.olt` markers to prevent false repository anchoring.
4. **Capsule Isolation (`.olt/capsules/`):**
   - `isInsideCapsule()` and `stripCapsulePath()` guarantee flat run allocation under `.olt/capsules/<run_id>` and mechanically reject nested capsule initializations (`initRun` throws `PATH_SAFETY` on in-capsule targets).
5. **Root Hygiene & Scratch Confinement (`RootDirectoryHygieneGuard`):**
   - [`olt/scripts/src/authority/root-hygiene-guard.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/authority/root-hygiene-guard.ts) intercepts path writes and rejects loose scratch scripts created directly in the repository root, ensuring all temporary execution and debug scaffolding is confined to `scratch/` or `.olt/scratch/`.
6. **Hermetic Test Environment Redirection:**
   - In test execution environments (`isTestEnvironment()`), `resolveSafeRoot()` automatically redirects dynamic ledger writes to process-isolated temporary directories (`resolveScratchDir()`), guaranteeing zero test pollution in either `olt/` or `.olt/`.

---

## 3. Implementation Tasks & Verification Matrix

| Task / Subsystem                  | Target Location                                                    | Codebase Status       | Verification Evidence / Artifact                                                                                                            |
| :-------------------------------- | :----------------------------------------------------------------- | :-------------------- | :------------------------------------------------------------------------------------------------------------------------------------------ |
| **Path Resolution Layer**         | `olt/scripts/src/core/shared/paths.ts`                             | **Fully Implemented** | `OLT_DIR_NAME = ".olt"` strictly resolves all governance files. Verified by `tests/unit/contracts/shared-paths.test.ts`.                    |
| **Root Scratch Guard**            | `olt/scripts/src/authority/root-hygiene-guard.ts`                  | **Fully Implemented** | `RootDirectoryHygieneGuard.assertAllowedWritePath(...)` blocks ad-hoc files. Verified by `tests/unit/authority/root-hygiene-guard.test.ts`. |
| **Safe Path Traversal & Escapes** | `olt/scripts/src/core/paths.ts`                                    | **Fully Implemented** | `safeRepoPath()` blocks parent traversal, symlink escapes, and invalid roots. Verified by `tests/unit/contracts/paths.test.ts`.             |
| **Capsule Nesting Isolation**     | `olt/scripts/src/core/shared/paths.ts` & `engine/store/capsule.ts` | **Fully Implemented** | `isInsideCapsule()` and `initRun()` interlocks enforce `.olt/capsules/` flat storage (Plan 27).                                             |
| **Global Packaging Isolation**    | `scripts/sync-global.ts`                                           | **Fully Implemented** | Synchronizes only `olt/` distribution assets to `~/.agents/skills/olt/`, completely excluding runtime ledgers.                              |

---

## 4. Empirical Evidence & Validation Matrix

| Invariant / Quality Gate       | Target Artifact                                   | Command / Validation Method                                | Result | Evidence Receipt                                    |
| :----------------------------- | :------------------------------------------------ | :--------------------------------------------------------- | :----- | :-------------------------------------------------- |
| **Shared Path Contracts**      | `olt/scripts/src/core/shared/paths.ts`            | `bun test tests/unit/contracts/shared-paths.test.ts`       | PASS   | 8 / 8 tests passing, 0 failures                     |
| **Root Hygiene Guard Tests**   | `olt/scripts/src/authority/root-hygiene-guard.ts` | `bun test tests/unit/authority/root-hygiene-guard.test.ts` | PASS   | 4 / 4 tests passing, 12 test assertions, 0 failures |
| **Core Path Safety Tests**     | `olt/scripts/src/core/paths.ts`                   | `bun test tests/unit/contracts/paths.test.ts`              | PASS   | 5 / 5 tests passing, 0 failures                     |
| **JSON Path Invariant Tests**  | `tests/unit/core/json-paths.test.ts`              | `bun test tests/unit/core/json-paths.test.ts`              | PASS   | 11 / 11 tests passing, 0 failures                   |
| **Repository-Wide Typecheck**  | Monorepo TypeScript Engine                        | `bun run typecheck` (`tsc -p tsconfig.json --noEmit`)      | PASS   | Exactly 0 errors, 0 `any` violations                |
| **Clean Root Directory Audit** | Monorepo Root Tree                                | Root inspection                                            | PASS   | Exactly 0 untracked scratch files in root           |

---

## 5. Summary of Deliverables & Governance Invariants

1. **Deterministic Sovereign Pathing:** `.olt/` is the single authoritative directory for all runtime state, governance policies, defect registries, and telemetry.
2. **Zero Source Pollution:** `olt/` is strictly preserved for versioned, distributable skill code, agent personas, checklists, and references.
3. **Permanent Regression Immunity:** All path resolvers and root hygiene guards are covered by dedicated contract test suites, preventing accidental directory pollution across all agentic and human workflows.
