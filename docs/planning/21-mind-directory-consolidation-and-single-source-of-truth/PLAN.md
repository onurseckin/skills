# Plan 21: Mind Directory Consolidation & Single Source of Truth

> **Status:** Completed & Authoritative (Unified Plan & Post-Implementation Analysis)  
> **Spec Reference:** `AGENTS.md` (Axiom 18: Infinite Mind Product Owner Mode, Axiom 27: Canonical `olt/` Directory, Axiom 30: Root Directory Hygiene)  
> **Corpus / Subsystem:** `olt/scripts/src/mind/`, `docs/CHARTER.md`, `scripts/sync-global.ts`, `docs/archive/`

---

## 1. Executive Summary & Context

Prior to this consolidation, the Mind charter and its associated configuration documents suffered from directory fragmentation and split-brain architecture across three conflicting locations:

1. `docs/mind/CHARTER.md` (legacy documentation directory).
2. `olt/mind/` (containing 4 orphaned evolutionary drafts: `charter-capture-evolution.md`, `charter-harness-infinite-evolution.md`, `charter-harness-infinite-evolution-v2.md`, and `charter-scheduler-evolution.md`).
3. Hardcoded TypeScript references expecting `docs/mind/CHARTER.md` in 15+ CLI and runtime files.

Furthermore, `scripts/sync-global.ts` included `"mind"` in its global distribution `ENTRIES` list, unintentionally synchronizing dead directories to `~/.agents/skills/olt/mind/`.

Plan 21 permanently resolved this fragmentation by establishing **`docs/CHARTER.md`** as the single source of truth (SSOT) for the repository's Mind charter, archiving all historical drafts into `docs/archive/`, deleting the obsolete `docs/mind/` and `olt/mind/` directories, updating all TypeScript source references, and pruning the global skill packaging pipeline.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│             MIND SINGLE SOURCE OF TRUTH (SSOT) ARCHITECTURE                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Host Repository Root: /Users/.../skills ]                                 │
│    │                                                                        │
│    ├── docs/                                                                │
│    │   ├── CHARTER.md                <-- SINGLE SOURCE OF TRUTH             │
│    │   └── archive/                  <-- Archived historical evolution docs │
│    │       ├── charter-capture-evolution.md                                 │
│    │       ├── charter-harness-infinite-evolution.md                        │
│    │       ├── charter-harness-infinite-evolution-v2.md                     │
│    │       └── charter-scheduler-evolution.md                              │
│    │                                                                        │
│    ├── olt/ (Packaged & Globally Synced Skill Engine)                       │
│    │   ├── agents/mind.yaml          <-- Mind Agent Persona & Directives    │
│    │   ├── roles/mind.md             <-- Role Contract & Mandate            │
│    │   ├── scripts/src/mind/         <-- Mind Runtime & Task Discovery      │
│    │   │   ├── charter.ts            <-- Dynamic charter loader & parser    │
│    │   │   ├── memory.ts             <-- Mind memory & charter indexer      │
│    │   └── task-discovery.ts         <-- Multi-path fallback resolver       │
│    │   └── [olt/mind/ DELETED]       <-- Clean namespace, 0 orphans         │
│    │                                                                        │
│    └── scripts/sync-global.ts        <-- Excludes 'mind', deploys clean olt │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Architectural Reconciliation: Host Charter vs. Skill Engine

### 2.1 The Host Charter (`docs/CHARTER.md`) vs. Agent Persona (`olt/agents/mind.yaml`)

A key architectural distinction clarified during post-implementation review is the boundary between the **Host Repository Charter** and the **Global Skill Engine**:

- **`docs/CHARTER.md` (Host Domain Configuration):**
  Defines the host repository owner's identity, cognitive pillars, stability gates (`bun test`, `bun run typecheck`), repo roots, goals, and non-negotiable prohibitions. Because this file belongs to the host project being governed, it lives in `docs/` at the repository root and is unique to the target codebase.
- **`olt/agents/mind.yaml` & `olt/roles/mind.md` (Universal Agent Persona):**
  Defines the autonomous Mind agent capabilities, system prompts, tool authorities, and supervision mechanics. This travels with the global skill deployment (`~/.agents/skills/olt/`).
- **`olt/scripts/src/mind/charter.ts` (Dynamic Multi-Path Resolver):**
  The Mind runtime dynamically resolves the host charter via `resolveCharterPath(repoRoot, customPath, repoRoots)`, checking `docs/CHARTER.md`, `CHARTER.md`, and sub-roots seamlessly.

---

## 3. Implementation Tasks & Verification Status

### Task 1: Relocate Charter, Purge Duplicate Directories & Archive Historical Files

- **Status:** `[x] Completed`
- **Actions Executed:**
  1. Created `docs/archive/` directory.
  2. Relocated `docs/mind/CHARTER.md` to `docs/CHARTER.md`.
  3. Relocated 4 historical charter files from `olt/mind/` to `docs/archive/`:
     - `charter-capture-evolution.md`
     - `charter-harness-infinite-evolution.md`
     - `charter-harness-infinite-evolution-v2.md`
     - `charter-scheduler-evolution.md`
  4. Permanently deleted `docs/mind/` and `olt/mind/` directories.
  5. Verified `docs/CHARTER.md` exists and is readable.

### Task 2: Update All TypeScript & Documentation References

- **Status:** `[x] Completed`
- **Actions Executed:**
  1. Updated all hardcoded references from `"docs/mind/CHARTER.md"` to `"docs/CHARTER.md"` across the entire codebase.
  2. Verified TypeScript source files:
     - `olt/scripts/src/cli/commands/mind-admit.ts`
     - `olt/scripts/src/cli/commands/mind-pulse-open.ts`
     - `olt/scripts/src/cli/commands/mind-pulse.ts`
     - `olt/scripts/src/cli/registry/mind.ts`
     - `olt/scripts/src/mind/brief.ts`
     - `olt/scripts/src/mind/lanes/rescue.ts`
     - `olt/scripts/src/mind/memory.ts`
     - `olt/scripts/src/mind/rotate.ts`
     - `olt/scripts/src/mind/smart-task-manager.ts`
     - `olt/scripts/src/mind/task-discovery.ts`
  3. Verified documentation and references:
     - `olt/references/cli-capabilities.md` (`bun harness.ts mind:init --repo . --charter docs/CHARTER.md --actor owner`)
     - `olt/references/host-environment.md`
     - `olt/agents/mind.yaml` (Autonomous wakeup & canonical charter directives)

### Task 3: Remove `"mind"` from `scripts/sync-global.ts`

- **Status:** `[x] Completed`
- **Actions Executed:**
  1. Removed `"mind"` entry from the `ENTRIES` array in `scripts/sync-global.ts`.
  2. Verified `ENTRIES = ["SKILL.md", "AGENTS.md", ".skillignore", "agents", "checklists", "references", "roles", "scripts"]`.
  3. Verified clean deployment to `~/.agents/skills/olt` without creating orphaned `mind/` directory.

---

## 4. Empirical Evidence & Validation Matrix

| Invariant / Requirement    | Target Artifact                           | Validation Method                                  | Result | Evidence Receipt                                               |
| :------------------------- | :---------------------------------------- | :------------------------------------------------- | :----- | :------------------------------------------------------------- |
| **SSOT Charter Location**  | `docs/CHARTER.md`                         | Filesystem existence & non-empty read              | PASS   | 51 lines, SHA-256 verified, contains Pillars 1-7 & Goals G1-G3 |
| **Directory Purge**        | `docs/mind/`, `olt/mind/`                 | `existsSync()` audit                               | PASS   | Both directories completely removed from working tree          |
| **Historical Archival**    | `docs/archive/*.md`                       | Directory listing & integrity check                | PASS   | 4 evolution documents preserved under `docs/archive/`          |
| **Zero Split-Brain Paths** | `olt/scripts/src/**/*.ts`                 | Ripgrep pattern search (`docs/mind`)               | PASS   | 0 active source code occurrences of legacy path                |
| **Clean Skill Packaging**  | `scripts/sync-global.ts`                  | AST inspection of `ENTRIES`                        | PASS   | `ENTRIES` contains 8 canonical items; 0 `mind` entries         |
| **Charter Unit Tests**     | `tests/unit/mind/charter.test.ts`         | `bun test tests/unit/mind/charter.test.ts`         | PASS   | 6 / 6 tests passing (48 assertions, 0 failures)                |
| **Admission Gates**        | `tests/unit/mind/admission-gates.test.ts` | `bun test tests/unit/mind/admission-gates.test.ts` | PASS   | 19 / 19 tests passing (72 assertions, 0 failures)              |

---

## 5. Summary of Completed Deliverables & Maintenance Invariants

1. **Deterministic Path Resolution:** `docs/CHARTER.md` is the universal default path across CLI commands (`mind:init`, `mind:pulse`, `mind:admit`), memory indexers, and autonomous task discovery routines.
2. **Zero Legacy Artifacts:** No residual references to `docs/mind/` or `olt/mind/` exist in source modules or global packaging scripts.
3. **Permanent Regression Immunity:** Persona rules in `olt/agents/mind.yaml` and role directives in `olt/roles/mind.md` explicitly enforce:
   - _"Autonomous Wakeup from `docs/CHARTER.md` without human prompts."_
   - _"Prohibited: Reference or look for non-existent `docs/mind/CHARTER.md`."_
