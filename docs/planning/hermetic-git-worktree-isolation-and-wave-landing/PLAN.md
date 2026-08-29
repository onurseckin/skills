# Master Plan: Hermetic Git Worktree Isolation & Per-Wave Atomic Landing Pipeline

> **Tracking ID:** `fb-1788022500000-hermetic-git-worktree-isolation-and-wave-landing`  
> **Status:** `PLANNED - READY FOR COORDINATOR DISPATCH`  
> **Priority:** `CRITICAL_USER_FEEDBACK`  
> **Target Subsystems:** `olt/scripts/src/workflow/worktree/`, `olt/scripts/src/orchestrator/`, `olt/scripts/src/reporting/doctor/`, `olt/scripts/src/cli/commands/`  
> **Author:** Strategic Mind Supervisor (`mind-gen-1`)  
> **Created:** 2026-08-29

---

## Level 1: Executive Context & Problem Statement

### 1.1 Architectural Context & Root Causes

During multi-track parallel execution, orchestrators running in the shared working tree on `main` collide during file modifications and block intermediate wave commits.

1. **Shared Workspace Collisions**:
   Multiple tracks editing files concurrently in the root workspace cause uncommitted state collisions and broken unit tests.
2. **Worktree Accumulation (Worktree Hell)**:
   Orphaned worktree directories and stale branches accumulate in `.olt/worktrees/` after agents terminate without clean teardown.
3. **Missing Worktree Health Engine**:
   `bun harness.ts doctor` lacks a dedicated `WorktreeHealthEngine` to audit worktree state, identify fully merged worktrees, or auto-clean dead worktrees.
4. **Delayed Upstream Landings**:
   Verified waves are blocked from immediate push to `origin/main` because uncommitted dirty state exists from concurrent tracks.

---

## Level 2: Target Architecture & ASCII Unicode Topology

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                 HERMETIC GIT WORKTREE ISOLATION & WAVE LANDING TOPOLOGY                     │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
                                             │
               ┌─────────────────────────────┼─────────────────────────────┐
               ▼                             ▼                             ▼
┌──────────────────────────────┐┌──────────────────────────────┐┌──────────────────────────────┐
│    Hermetic Provisioning     ││   Per-Wave Atomic Landing    ││    Doctor Worktree Engine    │
│ ──────────────────────────── ││ ──────────────────────────── ││ ──────────────────────────── │
│ • `git worktree add` track   ││ • In-tree wave commit        ││ • Stale worktree audit       │
│ • Branch: `track/<id>`       ││ • Rebase onto `origin/main`  ││ • Orphaned branch detection  │
│ • Isolated `.session.json`   ││ • Atomic `git push`          ││ • Automated prune & cleanup  │
│ • Dedicated write boundary   ││ • Immediate worktree remove  ││ • Zero worktree accumulation │
└──────────────────────────────┘└──────────────────────────────┘└──────────────────────────────┘
               │                             │                             │
               └─────────────────────────────┼─────────────────────────────┘
                                             ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                           DETERMINISTIC TEARDOWN INVARIANT                                  │
│ ─────────────────────────────────────────────────────────────────────────────────────────── │
│ • Every worktree and branch is destroyed immediately upon push to origin/main                │
│ • Zero lingering worktree locks; automatic `git worktree prune` after landing               │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Level 3: Disjoint Scope Boundaries

| Scope Domain             | Path Specification                                                                                                                       | Access Contract       |
| :----------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- | :-------------------- |
| **Write Scope (Lane A)** | `olt/scripts/src/workflow/worktree/manager.ts`, `olt/scripts/src/workflow/worktree/landing.ts`, `tests/unit/workflow/worktree.test.ts`   | Exclusive Write Lease |
| **Write Scope (Lane B)** | `olt/scripts/src/reporting/doctor/worktree-health-engine.ts`, `tests/unit/doctor/worktree-health.test.ts`                               | Exclusive Write Lease |
| **Write Scope (Lane C)** | `olt/scripts/src/cli/commands/worktree-ops.ts`, `tests/unit/cli/worktree-ops.test.ts`                                                     | Exclusive Write Lease |
| **Write Scope (Lane D)** | `olt/scripts/src/orchestrator/loop-runner.ts`, `olt/scripts/src/orchestrator/station-landing.ts`                                          | Exclusive Write Lease |
| **Read-Only Scope**      | `olt/scripts/src/core/`, `.olt/worktrees/`                                                                                               | Read-Only             |

---

## Level 4: Atomic Implementation Tasks Matrix

| Task ID        | Target File Path                                             | Exact TypeScript Symbols / Signatures                               | Deliverable & Contract ($\le 300$ lines, 0 comments)                                                                                                    |
| :------------- | :----------------------------------------------------------- | :------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task-wt-1.1`  | `olt/scripts/src/workflow/worktree/manager.ts`               | `createTrackWorktree(trackId: string): string`                      | Provision hermetic worktree in `.olt/worktrees/<trackId>` on branch `track/<trackId>`.                                                                   |
| `task-wt-1.2`  | `olt/scripts/src/workflow/worktree/manager.ts`               | `destroyTrackWorktree(trackId: string): void`                       | Safely remove worktree, delete branch `track/<trackId>`, and execute `git worktree prune`.                                                               |
| `task-wt-1.3`  | `olt/scripts/src/workflow/worktree/landing.ts`               | `landTrackToMain(trackId: string): Promise<void>`                   | Perform fetch, rebase onto `origin/main`, atomic push, and immediate worktree teardown.                                                                 |
| `task-wt-1.4`  | `tests/unit/workflow/worktree.test.ts`                       | `describe("Worktree Manager & Landing", ...)`                       | Unit test verifying provisioning, isolation, landing, and clean teardown in test repository.                                                            |
| `task-wt-2.1`  | `olt/scripts/src/reporting/doctor/worktree-health-engine.ts` | `checkWorktreeHealth(): Promise<DoctorCheckResult>`                 | Implement doctor check for unmerged branches, dead agent worktrees, and auto-cleanup.                                                                     |
| `task-wt-2.2`  | `tests/unit/doctor/worktree-health.test.ts`                  | `describe("Worktree Health Engine", ...)`                           | Unit test verifying doctor detection and auto-healing of stale worktrees.                                                                               |
| `task-wt-3.1`  | `olt/scripts/src/cli/commands/worktree-ops.ts`               | `worktreeCreateCommand`, `worktreeLandCommand`, etc.                | Expose CLI commands: `worktree:create`, `worktree:land`, `worktree:list`, `worktree:clean`, `worktree:status`.                                          |
| `task-wt-3.2`  | `tests/unit/cli/worktree-ops.test.ts`                        | `describe("Worktree CLI Ops", ...)`                                 | Unit test verifying CLI command execution and output formatting.                                                                                         |
| `task-wt-4.1`  | `olt/scripts/src/orchestrator/loop-runner.ts`                | `executeOrchestratorTrack(options: TrackOptions): Promise<void>`    | Bind orchestrator track to isolated worktree and execute per-wave landing.                                                                               |

---

## Level 5: Falsifiable Gate Verification Commands

```bash
# Gate 1: Worktree Provisioning and Landing
bun test tests/unit/workflow/worktree.test.ts

# Gate 2: Worktree Doctor Health Check
bun test tests/unit/doctor/worktree-health.test.ts

# Gate 3: Worktree CLI Operations
bun test tests/unit/cli/worktree-ops.test.ts

# Gate 4: System Invariant Check
bun ~/.agents/skills/olt/scripts/harness.ts task:check --repo .
```

---

## Level 6: Strict Invariant Enforcement

1. **Zero Code Comments**: No inline `//`, multiline `/* */`, or docblock `/** */` comments permitted in any `.ts` file.
2. **Density Budget**: Every modified file must remain $\le 300$ physical lines. Subdirectories must contain $\le 10$ files.
3. **Ban Defect-Prefix Source Files**: No `defect-*.ts` or `fb-*.ts` files permitted in source or test directories.
4. **Explicit Named Exports**: No `export *` wildcard re-exports. Every symbol must be explicitly named in `index.ts`.
5. **Zero Backwards-Compatibility Shims**: No deprecated type aliases, dead shims, or polyfill fallbacks.

---

## Level 7: Sequential Critical Path DAG & Work/Span Optimization

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                             CRITICAL PATH DAG (KAHN SORT)                                   │
└─────────────────────────────────────────────────────────────────────────────────────────────┘

  [Wave 1: Core Worktree Manager & Landing Engine]
      ├── Task wt-1.1 (Worktree Manager) ────────────┐
      ├── Task wt-1.2 (Worktree Teardown) ───────────┼──► [Gate 1: Worktree Test]
      ├── Task wt-1.3 (Atomic Landing) ──────────────┤
      └── Task wt-1.4 (Worktree Unit Test) ──────────┘
      │
  [Wave 2: Doctor Health & CLI Ops]
      ├── Task wt-2.1 (Doctor Health Engine) ────────┐
      ├── Task wt-2.2 (Doctor Health Test) ──────────┼──► [Gate 2: Doctor Health Test]
      │
      ├── Task wt-3.1 (CLI Ops Handlers) ────────────┐
      └── Task wt-3.2 (CLI Ops Unit Test) ───────────┴──► [Gate 3: CLI Ops Test]
                                                                  │
                                                                  ▼
  [Wave 3: Orchestrator Integration & System Seal]
      ├── Task wt-4.1 (Orchestrator Worktree Binding) ┐
      └── Task wt-5.1 (System Verification & Seal) ───┴──► [Gate 4: task:check]
```

**Work/Span Calculation**:

- Total Work ($W$): 9 discrete tasks $\approx 18$ minutes.
- Critical Path Span ($S$): 3 sequential wave barriers $\approx 6$ minutes.
- Optimal Concurrency: $P = \lceil W / S \rceil = \lceil 18 / 6 \rceil = 3$ concurrent implementers.
- Hard Concurrency Cap: Never exceed 50 active subagents across all tiers.

---

## Level 8: Exhaustive Traceability Matrix

| Backlog / Defect ID                                                | Title / Requirement                                  | Resolved By Tasks                                            | Falsifiable Gate Verification Target                  |
| :----------------------------------------------------------------- | :--------------------------------------------------- | :----------------------------------------------------------- | :---------------------------------------------------- |
| `fb-1788022500000-hermetic-git-worktree-isolation-and-wave-landing`| Hermetic Worktree Provisioning & Isolation           | `task-wt-1.1`, `task-wt-1.2`, `task-wt-1.4`                  | `bun test tests/unit/workflow/worktree.test.ts`       |
| `fb-1788022500000-hermetic-git-worktree-isolation-and-wave-landing`| Atomic Wave Landing & Immediate Teardown             | `task-wt-1.3`, `task-wt-4.1`                                 | `bun test tests/unit/workflow/worktree.test.ts`       |
| `fb-1788022500000-hermetic-git-worktree-isolation-and-wave-landing`| Worktree Doctor Diagnostic & Auto-Prune Engine       | `task-wt-2.1`, `task-wt-2.2`                                 | `bun test tests/unit/doctor/worktree-health.test.ts`  |
| `fb-1788022500000-hermetic-git-worktree-isolation-and-wave-landing`| Worktree Management CLI Commands                     | `task-wt-3.1`, `task-wt-3.2`                                 | `bun test tests/unit/cli/worktree-ops.test.ts`        |
