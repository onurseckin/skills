# DAG Graph Integrity, Doctor Dual-Channel Reconciliation & 4-Tier Hierarchy Master Plan

> **Tracking ID:** `plan-dag-graph-integrity-and-doctor-reconciliation`  
> **Priority:** `P0 - SYSTEM CRISIS (HALT & RE-PRIORITIZE)`  
> **Status:** `PHASE 1 - ARCHITECTURAL BLUEPRINT & FORMAL SPECIFICATION`  
> **Target Subsystems:** `olt/scripts/src/reporting/doctor/`, `olt/scripts/src/reporting/unified/`, `olt/scripts/src/cli/registry/`, `tests/reporting/`, `tests/cli/`  
> **Author:** Tier 0 Strategic Mind Supervisor (`mind-gen-6`)  
> **Created:** 2026-09-06

---

## 1. Executive Summary & Forensic Root Cause Analysis

A formal human user and operator intervention identified a critical architectural divergence:

1. **Agent Self-Blindness**: When an agent runs `doctor` or `report`, the active roster reports "0 agents running" or "No tasks declared in planning buffer/graph" despite active worktrees (`.olt/worktrees/*`) and live subagents on disk. Any currently active calling agent (`caller.actor` / `.session.json`) must ALWAYS see itself reflected in the live roster and system topology.
2. **Graph Health Disconnection**: `checkPlanningDag` currently evaluates to `passed: true` when `tasks: null / []`. If worktrees exist on disk or execution pulses/subagents are active, an empty task graph must immediately fail with `EMPTY_GRAPH_DURING_ACTIVE_EXECUTION` and `UNTRACKED_WORKTREE_DETECTED`.
3. **Phase-Skipping & Tier Collapse**: Bypassing Phase 1 plan compilation (`plan:init` -> `plan:add` -> `plan:compile`) and directly managing Tier 3 workers from Tier 0 Mind collapses the repository's 4-tier hierarchy. Skip-edges ($\Delta\text{tier} > 1$) in the supervisory DAG must be mathematically rejected.
4. **Unregistered CLI Command**: `dag:check` and `dag:heal` are implemented in `olt/scripts/src/cli/registry/dag.ts` but omitted from `COMMAND_REGISTRY` in `olt/scripts/src/cli/registry/index.ts`.
5. **Stale Mailbox Contamination**: `checkMailboxHealth` scans all historical directories in `.olt/mailboxes/`, causing false-positive diagnostic failures on dead mailboxes from earlier runs. It must be scoped strictly to the active capsule's agent set.

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                    P0 CRISIS REMEDIATION ARCHITECTURAL MATRIX                               │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│  Track 1: Self-Presence & Dual-Channel Worktree Reconciliation in Doctor & DAG              │
│  Track 2: Graph Integrity Invariants in checkPlanningDag & Tier Skip Edge Rejection         │
│  Track 3: CLI Registration of dag:check / dag:heal & Active Mailbox Scoping                 │
│  Track 4: Strict 4-Tier Supervisory Hierarchy Restoration (T0 -> T1 -> T2 -> T3)            │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Architectural Pillars & Invariants

1. **Self-Presence Invariant**:
   - The caller actor (from `.session.json` or command identity) is guaranteed to appear in the active multi-tier agent roster. An executing agent can never be invisible to itself.
2. **Dual-Channel Worktree & Task Reconciliation**:
   - `listTrackWorktrees(repoRoot)` is reconciled against active tasks in the capsule (`state.tasks`).
   - Any worktree without an active task binding, or any active execution state with 0 compiled tasks, triggers a critical diagnostic failure (`UNTRACKED_WORKTREE_DETECTED` / `EMPTY_GRAPH_DURING_ACTIVE_EXECUTION`).
3. **Mathematical Tier Hierarchy Invariant ($\Delta\text{tier} \le 1$)**:
   - Tier 0 (`mind`, `mind-auditor`, `skill-auditor`) $\to$ Tier 1 (`orchestrator`).
   - Tier 1 (`orchestrator`) $\to$ Tier 2 (`coordinator`).
   - Tier 2 (`coordinator`) $\to$ Tier 3 (`implementer`, `validator`, `completeness-critic`, `publisher`).
   - Any edge with $\Delta\text{tier} > 1$ (e.g. Tier 0 $\to$ Tier 3) is rejected by `checkPlanningDag` with `PLANNING_DAG_TIER_SKIP_VIOLATION`.
4. **Active Capsule Isolation**:
   - Diagnostics in `checkMailboxHealth` evaluate only mailboxes belonging to agents registered in the active run. Dead historical mailboxes are ignored.
5. **The 3 Hard Zeros (Supervisory Detachment)**:
   - 0 source code edits on Mind thread.
   - 0 test runs on Mind thread.
   - 0 completion critic runs on Mind thread.
   - Implementation is 100% delegated to leased Tier 3 Implementers in dedicated git worktrees.
6. **Physical Line Budget Invariant**:
   - All source files must remain $\le 300$ physical lines. Partition modular sub-engines when necessary.

---

## 3. Modular Track Specifications & Work Breakdown

### Track 1: Self-Presence & Dual-Channel Reconciliation in Doctor & DAG

- **Owner**: Tier 3 Implementer + Independent Validator
- **Worktree**: `.olt/worktrees/track-self-presence-reconciliation`
- **Write Scope**:
  - `olt/scripts/src/reporting/unified/fleet-builder.ts`
  - `olt/scripts/src/reporting/doctor/worktree-health-engine.ts`
  - `tests/reporting/fleet-presence-reconciliation.test.ts`
- **Specifications**:
  1. In `fleet-builder.ts`:
     - Inspect `.session.json` or active session grants. If the session actor is active and not yet present in `allAgentRows`, insert the calling agent into the Multi-Tier Agent Roster with their verified role and capsule binding.
     - Inspect `listTrackWorktrees(repoRoot)`. Include active worktree counts and statuses in the fleet summary.
  2. In `worktree-health-engine.ts`:
     - Accept `tasks` or `state` in `WorktreeHealthOptions`.
     - Reconcile `activeTrackWorktrees` against task definitions.
     - If an active worktree directory exists in `.olt/worktrees/` without an associated task or active track reservation, emit a diagnostic finding `UNTRACKED_WORKTREE_DETECTED` with severity `ERROR`.
  3. Acceptance Test:
     - Verify active caller is always present in generated fleet roster table.
     - Verify untracked worktrees fail doctor with `UNTRACKED_WORKTREE_DETECTED`.

### Track 2: Graph Integrity Invariants in checkPlanningDag & Tier-Skip Edge Rejection

- **Owner**: Tier 3 Implementer + Independent Validator
- **Worktree**: `.olt/worktrees/track-dag-graph-integrity`
- **Write Scope**:
  - `olt/scripts/src/reporting/doctor/planning-dag-engine.ts`
  - `tests/reporting/planning-dag-integrity.test.ts`
- **Specifications**:
  1. In `planning-dag-engine.ts`:
     - Update `PlanningDagCheckOptions` to accept `repoRoot`, `state`, `activeWorktreeCount`.
     - When `nodesMap.size === 0`:
       - Check if active worktrees exist (`listTrackWorktrees(options.repoRoot)`) or if `options.state?.pulses` indicates active execution.
       - If worktrees or active execution pulses exist with 0 tasks, emit `EMPTY_GRAPH_DURING_ACTIVE_EXECUTION` (severity: `ERROR`) and set `passed: false`.
  2. Implement Tier Skip-Edge Audit:
     - Map agent roles to tiers: Tier 0 = `mind`, `mind-auditor`, `skill-auditor`; Tier 1 = `orchestrator`; Tier 2 = `coordinator`; Tier 3 = `implementer`, `validator`, `completeness-critic`, `publisher`, `sub-*`.
     - When inspecting supervisory or dependency edges in the planning graph:
       - If an edge connects $A \to B$ where $\text{tier}(B) - \text{tier}(A) > 1$ (e.g. Tier 0 spawning or directly assigning Tier 3), emit `PLANNING_DAG_TIER_SKIP_VIOLATION` (severity: `ERROR`) and fail the check.
  3. Acceptance Test:
     - An empty graph with worktrees on disk fails with `EMPTY_GRAPH_DURING_ACTIVE_EXECUTION`.
     - An edge from Tier 0 to Tier 3 fails with `PLANNING_DAG_TIER_SKIP_VIOLATION`.
     - Standard hierarchical edges pass cleanly.

### Track 3: CLI Registration of dag:check & Stale Mailbox Scoping

- **Owner**: Tier 3 Implementer + Independent Validator
- **Worktree**: `.olt/worktrees/track-dag-cli-mailbox-scoping`
- **Write Scope**:
  - `olt/scripts/src/cli/registry/index.ts`
  - `olt/scripts/src/reporting/doctor/mailbox-health-engine.ts`
  - `olt/scripts/src/reporting/doctor/diagnostic-collector.ts`
  - `tests/cli/dag-commands-registration.test.ts`
  - `tests/reporting/mailbox-health-scoping.test.ts`
- **Specifications**:
  1. In `cli/registry/index.ts`:
     - Import `DAG_COMMANDS` from `./dag.ts`.
     - Add `...DAG_COMMANDS` to `COMMAND_REGISTRY`.
     - Export `DAG_COMMANDS`.
  2. In `mailbox-health-engine.ts`:
     - Filter `listAgentDirs(mailboxesDir)`: if `options.activeAgentIds` is populated, restrict checking exclusively to `agentId`s included in `options.activeAgentIds`.
     - If `options.state` is provided and contains `agents`, derive `activeAgentIds` from `state.agents`.
     - Ignore dead historical mailboxes belonging to agents not in the active run.
  3. In `diagnostic-collector.ts`:
     - Forward `state?.agents` as `activeAgentIds` to `checkMailboxHealth`.
  4. Acceptance Test:
     - `bun harness.ts dag:check` executes without `unknown command` error.
     - Stale mailboxes outside active run do not cause doctor failures.

### Track 4: Strict 4-Tier Supervisory Hierarchy Restoration

- **Owner**: Tier 0 Mind Supervisor Governance
- **Scope**:
  - Mind must strictly invoke Tier 1 Meta-Orchestrator (`orchestrator.yaml`).
  - Orchestrator dispatches Tier 2 Wave Coordinator (`coordinator.yaml`).
  - Coordinator provisions worktrees and leases Tier 3 Implementers / Validators.
  - Zero direct Tier 3 worker spawning or task assignment from Mind thread.

---

## 4. Parallel Worktree Allocation & Execution Plan ($P = 3$)

```text
Brent Concurrency Formulation:
W = 3 implementation tracks
S = 1 sequential phase
P = ceil(3 / 1) = 3 parallel worktrees
```

| Track       | Worktree Path                                       | Branch Name                                | Focus                                                    |
| :---------- | :-------------------------------------------------- | :----------------------------------------- | :------------------------------------------------------- |
| **Track 1** | `.olt/worktrees/track-self-presence-reconciliation` | `track/track-self-presence-reconciliation` | Self-presence in roster & worktree reconciliation        |
| **Track 2** | `.olt/worktrees/track-dag-graph-integrity`          | `track/track-dag-graph-integrity`          | `checkPlanningDag` empty-graph & tier-skip invariants    |
| **Track 3** | `.olt/worktrees/track-dag-cli-mailbox-scoping`      | `track/track-dag-cli-mailbox-scoping`      | CLI registration of `dag:check` & active mailbox scoping |

---

## 5. Exhaustive Traceability & Verification Gates

| Defect / Directive Requirement                       | Resolved By Track | Verification Gate                                                |
| :--------------------------------------------------- | :---------------- | :--------------------------------------------------------------- |
| Self-presence in agent roster table                  | Track 1           | `tests/reporting/fleet-presence-reconciliation.test.ts`          |
| Untracked worktree detection in doctor               | Track 1           | `bun test tests/reporting/fleet-presence-reconciliation.test.ts` |
| Empty graph during active execution rejection        | Track 2           | `tests/reporting/planning-dag-integrity.test.ts`                 |
| Tier skip-edge ($\Delta\text{tier} > 1$) rejection   | Track 2           | `bun test tests/reporting/planning-dag-integrity.test.ts`        |
| `dag:check` CLI command registration                 | Track 3           | `bun harness.ts dag:check` exit code 0                           |
| Active mailbox scoping (ignore stale dead mailboxes) | Track 3           | `tests/reporting/mailbox-health-scoping.test.ts`                 |
| Strict 4-tier supervisory dispatch                   | Track 4           | Pre-action sentinel cross-tier enforcement                       |
