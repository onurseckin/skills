# Multi-Orchestrator Topology & Mandatory Parallel Git Worktree Dispatch Master Plan

> **Tracking ID:** `plan-multi-orchestrator-worktree-topology`  
> **Priority:** `P0 - ARCHITECTURAL SCALING MANDATE`  
> **Status:** `PHASE 1 - ARCHITECTURAL BLUEPRINT & TASK BREAKDOWN`  
> **Target Subsystems:** `olt/scripts/src/sentinel/profiles/`, `olt/scripts/src/worktree/`, `olt/scripts/src/mind/`, `olt/scripts/src/reporting/doctor/`  
> **Author:** Antigravity AI Relay & System Architect  
> **Created:** 2026-09-06

> **Path-integrity note (2026-09-07):** `olt/scripts/src/worktree/` (including the `allocator.ts` /
> `registry.ts` targets in Track 2 below) does not exist and this plan is still Phase 1, so that is
> expected — but note there already IS a worktree lifecycle module at
> `olt/scripts/src/workflow/worktree/` (manager.ts, orchestrator.ts, provision.ts, etc.). Decide
> whether Track 2 extends that existing module or genuinely introduces a new sibling one before
> creating files — don't create a parallel `worktree/` tree by default.
> Separately: `tests/sentinel/profiles/tier-spawning-hierarchy.test.ts` (Track 1's verification
> file, moved into a `profiles/` subdirectory) already exists, likely from commit `2e8393736`
> ("semantic tier matching and anti-bottleneck violation") — re-verify how much of Track 1 is
> already done before treating it as unstarted.

---

## 1. Executive Summary & Root Cause Analysis

An architectural audit of runtime execution revealed that the long-task orchestration engine was bottlenecking on a single-threaded hierarchical funnel:

```text
CURRENT SINGLE-THREADED FUNNEL BOTTLENECK:
┌─────────────────────────────────────────────────────────────┐
│                    TIER 0 MIND (mind-gen-6)                 │
└──────────────────────────────┬──────────────────────────────┘
                               │ (P = 1 Single-Channel Bottleneck!)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             TIER 1 META-ORCHESTRATOR (Singleton)            │
└──────────────────────────────┬──────────────────────────────┘
                               │ (P = 1 Single-Channel Bottleneck!)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│               TIER 2 WAVE COORDINATOR (Singleton)           │
└──────────────────────────────┬──────────────────────────────┘
                               │
            ┌──────────────────┼──────────────────┐
            ▼                  ▼                  ▼
       [Track 1 Worktree] [Track 2 Worktree] [Track 3 Worktree]
            │                  │                  │
            └──────────────────┴──────────────────┘
                               │ (Artificial Wave Barrier!)
                               ▼
               [Wave 2: Track 5] (Blocked & Serialized!)
```

### Forensic Root Causes:

1. **Hardcoded Sentinel Role Matching Defect:**
   - In [`olt/scripts/src/sentinel/profiles/tier0/mind.ts:71`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/sentinel/profiles/tier0/mind.ts#L71), `allowedMindSpawns = new Set(["orchestrator", "mind-auditor", "skill-auditor"])` performs an exact string lookup.
   - In [`olt/scripts/src/sentinel/profiles/tier1/orchestrator.ts:47`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/sentinel/profiles/tier1/orchestrator.ts#L47), `allowedOrchestratorSpawns = new Set(["coordinator"])` performs an exact string lookup.
   - When Mind attempted to dispatch semantic multi-orchestrators (`orchestrator_reporting`, `orchestrator_sentinel`, `orchestrator_dag`), the Sentinel threw a critical `CROSS_TIER_SPAWNING_VIOLATION`. This conditioned Mind to spawn only a single generic `"orchestrator"`.
2. **False Serialization of Disjoint Tracks into Sequential Waves:**
   - Tracks with completely disjoint write scopes (e.g. Track 5 Canonical Alignment touching only brand new files) were artificially gated behind Wave 1 landing, violating the Gen5 Dynamic Wave Decoupling Invariant.
3. **Git Worktree Isolation Restricted to Tier 3:**
   - Git worktrees were used solely for worker sandboxing (`.olt/worktrees/track-*`). Tier 1 Orchestrators operated in the shared root, making concurrent multi-orchestrator execution impossible without working-tree pollution.

---

## 2. Core Architectural Pillars & Mandates

```text
MANDATORY MULTI-ORCHESTRATOR TOPOLOGY:
┌────────────────────────────────────────────────────────────────────────┐
│                        TIER 0 STRATEGIC MIND                           │
│  - Calculates Brent Concurrency: P_tier1 = ceil(W_clusters / S)        │
│  - Partitions backlog into macro domain clusters                       │
│  - Mandates >= 2 Tier 1 Orchestrators when clusters >= 2               │
│  - Allocates dedicated Git worktrees per Orchestrator                  │
└───────────────────────┬────────────────────────┬───────────────────────┘
                        │                        │
         ┌──────────────┘                        └──────────────┐
         ▼                                                      ▼
┌────────────────────────────────────────┐   ┌────────────────────────────────────────┐
│ TIER 1 ORCHESTRATOR (Domain A)         │   │ TIER 1 ORCHESTRATOR (Domain B)         │
│ Worktree: .olt/worktrees/orch-domain-a │   │ Worktree: .olt/worktrees/orch-domain-b │
│ Role: orchestrator_reporting           │   │ Role: orchestrator_sentinel            │
└──────────────────┬─────────────────────┘   └──────────────────┬─────────────────────┘
                   │                                            │
                   ▼                                            ▼
┌────────────────────────────────────────┐   ┌────────────────────────────────────────┐
│      TIER 2 COORDINATOR (Domain A)     │   │      TIER 2 COORDINATOR (Domain B)     │
│ Role: coordinator_reporting            │   │ Role: coordinator_sentinel             │
└──────────┬──────────────────┬──────────┘   └──────────┬──────────────────┬──────────┘
           ▼                  ▼                         ▼                  ▼
    [Track A1 Worker]  [Track A2 Worker]         [Track B1 Worker]  [Track B2 Worker]
```

### Pillar 1: Mandatory Multi-Orchestrator Scaling ($P_{\text{tier1}} \ge 2$)

When a backlog or plan contains $\ge 2$ disjoint thematic clusters, Tier 0 Mind is **mandated** to deploy $\ge 2$ Tier 1 Orchestrators concurrently. A single orchestrator attempting to manage multiple distinct domains is rejected by the Sentinel with `SINGLE_ORCHESTRATOR_BOTTLENECK_VIOLATION`.

### Pillar 2: Mandatory Hermetic Git Worktrees for Every Orchestrator

Every Tier 1 Orchestrator must be initialized within its own dedicated git worktree located at `.olt/worktrees/orch-<domain>/` on branch `orch/<domain>`.

- Orchestrators and their child Coordinators/Workers execute exclusively within that worktree's filesystem boundary.
- Multiple Orchestrators operate with 100% isolation from each other and from the root working tree.

### Pillar 3: Semantic Role Matching in Sentinel Profiles & RBAC

Sentinel profiles must eliminate rigid string sets and rely on [`roleToTier(role)`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/packets/command-authority-hierarchy.ts#L11):

- `mindProfile`: Mind may spawn any role where `roleToTier(role) === 1` (`orchestrator`, `orchestrator_<domain>`, `orchestrator-<domain>`) and Tier 0 auditors (`mind-auditor`, `skill-auditor`).
- `orchestratorProfile`: Orchestrator may spawn any role where `roleToTier(role) === 2` (`coordinator`, `coordinator_<scope>`, `coordinator-<scope>`).

### Pillar 4: Asynchronous Multi-Worktree Landing & Conflict-Free Merging

Each Orchestrator worktree lands to `main` as an independent atomic unit upon completion of its internal waves, passing 2-Key Validator pairing and pre-commit modularity checks without blocking other orchestrators.

---

## 3. Modular Track Breakdown

### Track 1: Sentinel Role Hierarchy Unification & Anti-Bottleneck Gate

- **Files to Modify:**
  - [`olt/scripts/src/sentinel/profiles/tier0/mind.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/sentinel/profiles/tier0/mind.ts)
  - [`olt/scripts/src/sentinel/profiles/tier1/orchestrator.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/sentinel/profiles/tier1/orchestrator.ts)
  - `tests/sentinel/profiles/tier-spawning-hierarchy.test.ts`
- **Deliverables:**
  1. Replace `allowedMindSpawns = new Set(...)` with `roleToTier(childRole) === 1` check, allowing `orchestrator_*`.
  2. Replace `allowedOrchestratorSpawns = new Set(...)` with `roleToTier(childRole) === 2` check, allowing `coordinator_*`.
  3. Introduce `SINGLE_ORCHESTRATOR_BOTTLENECK_VIOLATION` in `mindProfile`: when `context.cluster_count >= 2` and `context.active_orchestrator_count < 2`, emit a critical sentinel violation.

### Track 2: Tier 0 Orchestrator Git Worktree Allocation Engine

- **Files to Modify:**
  - `olt/scripts/src/worktree/allocator.ts`
  - `olt/scripts/src/worktree/registry.ts`
  - [`olt/scripts/src/reporting/doctor/worktree-health-engine.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/reporting/doctor/worktree-health-engine.ts)
  - `tests/worktree/orchestrator-worktree-allocation.test.ts`
- **Deliverables:**
  1. Add support for `--tier orchestrator` in `worktree:create` provisioning `.olt/worktrees/orch-<domain>` with branch `orch/<domain>`.
  2. Update Universal Doctor's worktree reconciliation to recognize both track-level and orchestrator-level worktrees.

### Track 3: Mind Multi-Orchestrator Macro Partitioning & Dispatch

- **Files to Modify:**
  - `olt/scripts/src/mind/preplanning/continuous-preplanner.ts`
  - `olt/scripts/src/mind/lifecycle/orchestration/product-manager.ts`
  - `tests/mind/multi-orchestrator-dispatch.test.ts`
- **Deliverables:**
  1. Partition backlog items and candidate defects into disjoint clusters.
  2. Automate creation of parallel git worktrees for each cluster.
  3. Dispatch concurrent Tier 1 Orchestrator subagents mapped 1:1 to their worktree directories.

---

## 4. Verification & Quality Gates

| Gate / Requirement                     | Target File / Command                                     | Expected Proof                                                                |
| :------------------------------------- | :-------------------------------------------------------- | :---------------------------------------------------------------------------- |
| Semantic Orchestrator Spawning Allowed | `tests/sentinel/profiles/tier-spawning-hierarchy.test.ts` | `roleToTier` passes `orchestrator_reporting` and `coordinator_wave1`          |
| Anti-Bottleneck Gate Active            | `mindProfile.evaluate`                                    | Fails if `cluster_count >= 2` and `orchestrator_count == 1`                   |
| Orchestrator Worktree Allocation       | `bun harness.ts worktree:create --orchestrator reporting` | Worktree exists at `.olt/worktrees/orch-reporting` on branch `orch/reporting` |
| Universal Doctor Clean                 | `bun harness.ts doctor`                                   | All orchestrator worktrees reconciled without orphan warnings                 |
| Physical Line Budget                   | All modified files                                        | Strictly $\le 300$ physical lines per file                                    |
