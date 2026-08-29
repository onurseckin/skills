# Blueprint: Hermetic Git Worktree Isolation, Atomic Wave Landing & Doctor Auto-Cleanup Engine

**Domain:** `workflow` / `orchestration` / `git` / `reporting`  
**Priority:** `CRITICAL`  
**Status:** `READY_FOR_EXECUTION`

---

## 1. Problem Statement & Architectural Gap

Currently, parallel orchestrator tracks executing in the shared working tree on `main` block intermediate wave commits. Furthermore, without deterministic worktree lifecycle governance:

1. **Worktree Hell**: Orphaned worktree directories and stale branches accumulate in `.olt/worktrees/` after agents terminate or complete tasks.
2. **Missing Doctor Observability**: `bun harness.ts doctor` lacks a dedicated `WorktreeHealthEngine` to audit worktree state, identify fully merged/pushed worktrees that were never destroyed, or auto-clean dead worktrees.
3. **Dirty Git State**: Lingering worktree locks or dead references cause future `git worktree add` commands to fail with path collisions.

---

## 2. Target Architecture: Hermetic Lifecycle & Zero-Worktree-Hell Invariant

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│          HERMETIC WORKTREE ISOLATION, ATOMIC LANDING & AUTO-CLEANUP         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Phase 1: Hermetic Provisioning ]                                         │
│    • `git worktree add .olt/worktrees/<track_id> -b track/<track_id> main` │
│    • Registers lease in `.olt/capsules/<run_id>/worktree.json`.             │
│                                                                             │
│  [ Phase 2: Hermetic Wave Implementation & Verification ]                   │
│    • Coordinators & Implementers work 100% inside worktree boundary.        │
│    • File edits and unit test gates run with zero cross-track interference. │
│                                                                             │
│  [ Phase 3: Atomic Landing & Immediate Push to Main ]                       │
│    • Wave commits inside worktree: `git commit -m "feat(...): ..."`         │
│    • Upstream synchronization: `git fetch origin main && git rebase main`   │
│    • Fast-forward atomic push: `git push origin main`                       │
│                                                                             │
│  [ Phase 4: Deterministic Teardown (Zero Worktree Hell) ]                   │
│    • Immediate removal: `git worktree remove --force .olt/worktrees/<track>`│
│    • Branch deletion: `git branch -D track/<track_id>`                      │
│    • Clean git metadata: `git worktree prune`                               │
│                                                                             │
│  [ Phase 5: Harness Doctor Worktree Health & Auto-Healing Engine ]          │
│    • Audit 1: Detects and flags merged worktrees not yet destroyed.         │
│    • Audit 2: Detects orphaned worktrees from crashed / dead agent PIDs.    │
│    • Auto-Heal: Automatically runs `cleanupStaleWorktrees()` during doctor. │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Implementation Tasks Breakdown

| Task ID         | Component / File                                                     | Deliverable                                                                                                                                       | Gate Verification                             |
| :-------------- | :------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------- |
| **`task-wt-1`** | `olt/scripts/src/workflow/worktree/manager.ts`                       | Implement `createTrackWorktree(trackId, baseBranch)` and `destroyTrackWorktree(trackId)` with mandatory branch deletion and `git worktree prune`. | Unit tests in `tests/unit/workflow/worktree/` |
| **`task-wt-2`** | `olt/scripts/src/workflow/worktree/landing.ts`                       | Implement `landTrackToMain(trackId)`: automated fetch, rebase onto `origin/main`, atomic push, and immediate worktree + branch destruction.       | Integration tests in hermetic git repo        |
| **`task-wt-3`** | `olt/scripts/src/reporting/doctor/worktree-health-engine.ts`         | Implement `checkWorktreeHealth` and `autoHealWorktreeState`: audit stale/merged worktrees, detect dead agent worktrees, and auto-prune them.      | Unit tests in `tests/unit/doctor/`            |
| **`task-wt-4`** | `olt/scripts/src/reporting/doctor/engines.ts` & `doctor.ts`          | Re-export `checkWorktreeHealth` and register it in the master `doctor` CLI execution pipeline.                                                    | Master doctor E2E tests                       |
| **`task-wt-5`** | `olt/scripts/src/cli/commands/worktree-ops.ts`                       | Expose CLI subcommands: `worktree:create`, `worktree:land`, `worktree:list`, `worktree:clean`, `worktree:status`.                                 | CLI execution tests                           |
| **`task-wt-6`** | `olt/scripts/src/orchestrator/loop-runner.ts` & `station-landing.ts` | Integrate hermetic worktrees into Orchestrator lifecycle: auto-bind worktrees and trigger atomic landing + teardown.                              | Orchestrator E2E tests                        |
| **`task-wt-7`** | `olt/agents/orchestrator.yaml` & `coordinator.yaml`                  | Update manifests to mandate `--worktree .olt/worktrees/<track_id>` execution and automatic teardown verification.                                 | Manifest validation test                      |

---

## 4. Acceptance Criteria & Invariants

1. **Deterministic Teardown (Zero Worktree Hell)**: Every worktree and its tracking branch are immediately destroyed upon push to `origin/main`.
2. **Comprehensive Doctor Health Engine**: `bun harness.ts doctor` audits worktree health, detects lingering merged/dead worktrees, and auto-heals them via `git worktree remove` and `git worktree prune`.
3. **Zero Shared Working Tree Conflicts**: Concurrent tracks strictly execute in dedicated `.olt/worktrees/<track_id>` workspaces.
4. **Instant Per-Wave Commit & Push**: Completed waves land and push to `origin/main` immediately upon verification without waiting for unrelated tracks.
5. **Modularity & Zero Comments**: All files strictly $\le 300$ physical lines, explicit named exports in `index.ts`, and 0 comments in `.ts` files.
