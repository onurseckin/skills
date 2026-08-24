# Plan 4: Unified `.olt/` Governance & Directory Standard

## 1. Context & Problem Statement

In previous iterations, confusion arose across agents and toolchains regarding the distinction between `olt/` and `.olt/`. Some subagents attempted to read or write governance records into `olt/backlog.jsonl` while runtime capsules were placed in `.olt/capsules/` or `.olt/capsules/`.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                          UNIFIED DIRECTORY STANDARD                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ olt/ — Skill Package Distribution (Committed Toolchain) ]                │
│    • olt/SKILL.md              (Canonical skill definition)                 │
│    • olt/roles/*.md            (Agent role contracts)                       │
│    • olt/scripts/              (Harness TypeScript source & CLI)            │
│                                                                             │
│  [ .olt/ — Repository Governance & Runtime (Single Source of Truth) ]       │
│    • COMMITTED TO GIT (Governance & Long-Term Memory):                      │
│        - .olt/policy.json            (Repository configuration & rules)     │
│        - .olt/backlog.jsonl          (Autonomous PO candidate backlog)      │
│        - .olt/completed-tasks.jsonl  (Permanent completed task archive)    │
│        - .olt/defects.jsonl          (Active empirical defect registry)     │
│        - .olt/completed-defects.jsonl(Resolved & proven defects)            │
│        - .olt/telemetry.jsonl        (Cryptographically signed event log)   │
│        - .olt/memory.json            (Cross-generational cognitive memory)  │
│        - .olt/watchdogs.json         (Supervisory heartbeat registry)       │
│                                                                             │
│    • GITIGNORED (Runtime Capsules & Sandboxes):                             │
│        - .olt/capsules/<run-id>/     (Live & completed execution runs)      │
│        - .olt/scratch/               (Disposable test sandboxes & evidence) │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Objectives & Acceptance Criteria

1. **Unambiguous Single Source of Truth (`.olt/`):**
   - All runtime operations, governance reads, defect promotions, telemetry logging, and capsule storage must resolve strictly to `.olt/`.
2. **Zero Fallback / Zero Ambiguity:**
   - Eliminate all code paths that check whether `olt/` or `.olt/capsules/` exist. If a path is needed, it is strictly `.olt/<file>`.
3. **Clean Git Tracking & Exclusion Invariants:**
   - `.gitignore` must contain exactly:
     ```gitignore
     # OLT Runtime Capsules & Ephemeral Scratch
     .olt/capsules/
     .olt/scratch/
     ```
   - All `.olt/*.jsonl` and `.olt/*.json` governance files remain committed and tracked.
4. **Agent Briefing Alignment (`agent:brief` & `task:brief`):**
   - Subagent dispatch briefings must explicitly instruct subagents that repository governance and execution live strictly under `.olt/`.

---

## 3. Detailed Technical Architecture

### 3.1 Canonical Paths Module (`olt/scripts/src/shared/paths.ts`)

```typescript
import { join, resolve } from "node:path";
import { findRepoRoot } from "./root-finder.ts";

export const OLT_DIR = ".olt";
export const CAPSULES_DIR = "capsules";
export const SCRATCH_DIR = "scratch";

export const OLT_FILES = {
  POLICY: "policy.json",
  BACKLOG: "backlog.jsonl",
  COMPLETED_TASKS: "completed-tasks.jsonl",
  DEFECTS: "defects.jsonl",
  COMPLETED_DEFECTS: "completed-defects.jsonl",
  TELEMETRY: "telemetry.jsonl",
  MEMORY: "memory.json",
  WATCHDOGS: "watchdogs.json",
} as const;

export function resolveOltDir(repoRoot: string = findRepoRoot()): string {
  return join(resolve(repoRoot), OLT_DIR);
}

export function resolveCapsulesDir(repoRoot: string = findRepoRoot()): string {
  return join(resolveOltDir(repoRoot), CAPSULES_DIR);
}

export function resolveScratchDir(repoRoot: string = findRepoRoot()): string {
  return join(resolveOltDir(repoRoot), SCRATCH_DIR);
}

export function resolveEvidenceDir(repoRoot: string = findRepoRoot()): string {
  return join(resolveScratchDir(repoRoot), "evidence");
}

export function resolveGovernanceFile(
  fileName: keyof typeof OLT_FILES,
  repoRoot: string = findRepoRoot(),
): string {
  return join(resolveOltDir(repoRoot), OLT_FILES[fileName]);
}
```

---

## 4. Implementation Steps

1. **Step 1:** Replace all legacy multi-variant resolvers in `shared/paths.ts` with direct, single-target `.olt/` functions (`resolveGovernanceFile`, `resolveCapsulesDir`, `resolveScratchDir`).
2. **Step 2:** Update `.gitignore` to explicitly ignore only `.olt/capsules/` and `.olt/scratch/`.
3. **Step 3:** Update agent prompt templates and dispatchers (`task:brief`, `agent:brief`) to embed the single `.olt/` standard.
4. **Step 4:** Add invariant unit tests in `tests/unit/shared/paths.test.ts` verifying that:
   - All governance paths resolve strictly under `<repo>/.olt/`.
   - Capsules resolve strictly under `<repo>/.olt/capsules/`.
   - Scratch and evidence resolve strictly under `<repo>/.olt/scratch/`.
   - 0 references to legacy `.olt/capsules/` or `TODO_*` remain.
