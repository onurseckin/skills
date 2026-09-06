# DAG Graph Integrity, Doctor Dual-Channel Reconciliation & Live Sentinel Interlock Master Plan

> **Tracking ID:** `plan-dag-graph-integrity-and-doctor-reconciliation`  
> **Priority:** `P0 - SYSTEM CRISIS (HALT & RE-PRIORITIZE)`  
> **Status:** `PHASE 1 - ARCHITECTURAL SPECIFICATION & TASK BREAKDOWN`  
> **Target Subsystems:** `olt/scripts/src/reporting/doctor/`, `olt/scripts/src/sentinel/`, `olt/scripts/src/reporting/unified/`, `olt/scripts/src/cli/`  
> **Author:** Tier 0 Strategic Mind Supervisor (`mind-gen-6`)  
> **Created:** 2026-09-06

---

## 1. Executive Summary & Forensic Root Cause Analysis

A formal human user intervention identified an architectural divergence in runtime governance:

1. **Agent Self-Blindness**: When an agent runs `doctor` or `report`, the active roster reports "0 agents running" or "No tasks declared" despite active worktrees (`.olt/worktrees/*`) and live subagents on disk. Any currently active calling agent (`caller.actor` / `.session.json`) must ALWAYS see itself reflected in the live roster and system topology.
2. **Graph Health Disconnection**: `checkPlanningDag` evaluates to `passed: true` when `tasks: null / []`. If worktrees exist on disk or execution pulses/subagents are active, an empty task graph must immediately fail with `EMPTY_GRAPH_DURING_ACTIVE_EXECUTION` and `UNTRACKED_WORKTREE_DETECTED`.
3. **Phase-Skipping & Tier Collapse**: Bypassing Phase 1 plan compilation (`plan:init` -> `plan:add` -> `plan:compile`) and directly managing Tier 3 workers from Tier 0 Mind collapses the repository's 4-tier hierarchy. Skip-edges ($\Delta\text{tier} > 1$) in the supervisory DAG must be mathematically rejected.
4. **Universal Doctor as SSoT**: `doctor` must be completely self-sufficient. A single `doctor` invocation must report any and all problems across every feature in the CLI. All agent governance, completion checks, and turn reviews must anchor strictly on `doctor`.
5. **Sentinel Coupled to Live Doctor**: Sentinel must not be a detached scanner; it must evaluate live Doctor diagnostics and mechanically BLOCK unauthorized actions (exit code 3 / hard exception).
6. **Forced Sentinel Intercept Messaging**: When a sentinel blocks an action, it must dispatch an explicit `SENTINEL_INTERCEPT` receipt via mailbox IPC (`msg:send`) to the agent and its supervisor with exact blocker and remediation commands.
7. **Unregistered CLI Command**: `dag:check` and `dag:heal` are missing from `COMMAND_REGISTRY` in `olt/scripts/src/cli/registry/index.ts`.
8. **Stale Mailbox Contamination**: `checkMailboxHealth` scans all historical directories in `.olt/mailboxes/`, causing false-positive failures on dead mailboxes. It must be scoped strictly to the active capsule.

---

## 2. Core Architectural Pillars & Invariants

1. **Universal Doctor Single Source of Truth**:
   - `doctor` aggregates all diagnostic engines: planning DAG, agent presence, worktree tracking, pushback quotas, supervisory hierarchy, mailbox health, and AST purity.
2. **Self-Presence Invariant**:
   - The caller actor (from `.session.json` or command identity) is guaranteed to appear in the active multi-tier agent roster. An executing agent can never be invisible to itself.
3. **Dual-Channel Worktree & Task Reconciliation**:
   - `listTrackWorktrees(repoRoot)` is reconciled against active tasks in the capsule (`state.tasks`).
   - Any worktree without an active task binding, or any active execution state with 0 compiled tasks, triggers a critical diagnostic failure (`UNTRACKED_WORKTREE_DETECTED` / `EMPTY_GRAPH_DURING_ACTIVE_EXECUTION`).
4. **Mathematical Tier Hierarchy Invariant ($\Delta\text{tier} \le 1$)**:
   - Tier 0 (`mind`, auditors) $\to$ Tier 1 (`orchestrator`) $\to$ Tier 2 (`coordinator`) $\to$ Tier 3 (`implementer`, `validator`, `publisher`).
   - Any edge with $\Delta\text{tier} > 1$ is rejected by `checkPlanningDag` with `PLANNING_DAG_TIER_SKIP_VIOLATION`.
5. **Live Sentinel Blocking & Forced IPC Intercept**:
   - Sentinels run live `doctor` probes during `executePreActionHook`. Any critical doctor error blocks execution.
   - Upon block, an automated `SENTINEL_INTERCEPT` notification is deposited via mailbox IPC to the agent and its parent supervisor.
6. **Active Capsule Mailbox Scoping**:
   - Diagnostics in `checkMailboxHealth` evaluate only mailboxes belonging to agents in the active run. Dead historical mailboxes are ignored.
7. **The 3 Hard Zeros (Supervisory Detachment)**:
   - 0 source code edits on Mind thread; 0 test runs on Mind thread; 0 critic runs on Mind thread.
8. **Line Budget Invariant**:
   - All source files must remain $\le 300$ physical lines.

---

## 3. Modular Track Specifications & Work Breakdown

### Track 1: Self-Presence, Worktree Reconciliation & Universal Doctor SSoT

- **Owner**: Tier 3 Implementer + Independent Validator
- **Worktree**: `.olt/worktrees/track-self-presence-reconciliation`
- **Write Scope**:
  - `olt/scripts/src/reporting/unified/fleet-builder.ts`
  - `olt/scripts/src/reporting/doctor/worktree-health-engine.ts`
  - `tests/reporting/fleet-presence-reconciliation.test.ts`
- **Specifications**:
  1. In `fleet-builder.ts`:
     - Inspect `.session.json` or active session grants. If the session actor is active and not present in `allAgentRows`, inject the calling agent into the Multi-Tier Agent Roster with role and capsule binding.
     - Inspect `listTrackWorktrees(repoRoot)`. Include active worktree counts and statuses in the fleet summary.
  2. In `worktree-health-engine.ts`:
     - Accept `tasks` or `state` in `WorktreeHealthOptions`.
     - Reconcile `activeTrackWorktrees` against task definitions.
     - If an active worktree directory exists in `.olt/worktrees/` without an associated task or active track reservation, emit diagnostic finding `UNTRACKED_WORKTREE_DETECTED` (severity: `ERROR`).

### Track 2: Graph Integrity, Tier-Skip Rejection & Live Sentinel Doctor Interlock

- **Owner**: Tier 3 Implementer + Independent Validator
- **Worktree**: `.olt/worktrees/track-dag-graph-integrity`
- **Write Scope**:
  - `olt/scripts/src/reporting/doctor/planning-dag-engine.ts`
  - `olt/scripts/src/sentinel/hooks.ts`
  - `olt/scripts/src/sentinel/interceptor.ts`
  - `tests/reporting/planning-dag-integrity.test.ts`
  - `tests/sentinel/live-doctor-sentinel.test.ts`
- **Specifications**:
  1. In `planning-dag-engine.ts`:
     - Accept `repoRoot`, `state`, `activeWorktreeCount` in `PlanningDagCheckOptions`.
     - When `nodesMap.size === 0`: check if active worktrees exist (`listTrackWorktrees`) or active pulses exist. If so, emit `EMPTY_GRAPH_DURING_ACTIVE_EXECUTION` (severity: `ERROR`) and fail the check.
     - Enforce $\Delta\text{tier} \le 1$. If an edge skips tiers (e.g. Tier 0 $\to$ Tier 3), emit `PLANNING_DAG_TIER_SKIP_VIOLATION` (severity: `ERROR`).
  2. In `sentinel/hooks.ts` & `sentinel/interceptor.ts`:
     - In `executePreActionHook`, trigger a fast doctor evaluation for active capsule. If `findings` contain critical errors (`EMPTY_GRAPH_DURING_ACTIVE_EXECUTION`, `UNTRACKED_WORKTREE_DETECTED`, `CROSS_TIER_SPAWNING_VIOLATION`), block the action.
     - Send a structured `SENTINEL_INTERCEPT` message via `sendMessageToAgent` to the caller's mailbox and supervisor mailbox before throwing `HarnessError("ROLE_CONFINEMENT_VIOLATION", ...)`.

### Track 3: CLI Registration of dag:check & Active Mailbox Scoping

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
     - Import `DAG_COMMANDS` from `./dag.ts`. Add `...DAG_COMMANDS` to `COMMAND_REGISTRY` and export it.
  2. In `mailbox-health-engine.ts`:
     - If `options.activeAgentIds` or `options.state` is provided, restrict mailbox checks to active agents. Dead historical mailboxes are ignored.
  3. In `diagnostic-collector.ts`:
     - Forward `state?.agents` as `activeAgentIds` to `checkMailboxHealth`.

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
Brent Concurrency: P = ceil(3 / 1) = 3 parallel tracks
```

| Track       | Worktree Path                                       | Branch Name                                | Focus                                                         |
| :---------- | :-------------------------------------------------- | :----------------------------------------- | :------------------------------------------------------------ |
| **Track 1** | `.olt/worktrees/track-self-presence-reconciliation` | `track/track-self-presence-reconciliation` | Self-presence in roster & worktree reconciliation             |
| **Track 2** | `.olt/worktrees/track-dag-graph-integrity`          | `track/track-dag-graph-integrity`          | `checkPlanningDag` invariants & Sentinel Doctor IPC intercept |
| **Track 3** | `.olt/worktrees/track-dag-cli-mailbox-scoping`      | `track/track-dag-cli-mailbox-scoping`      | CLI registration of `dag:check` & active mailbox scoping      |

---

## 5. Traceability & Verification Gates

| Defect / Directive Requirement                       | Resolved By Track | Verification Gate                                                |
| :--------------------------------------------------- | :---------------- | :--------------------------------------------------------------- |
| Self-presence in agent roster table                  | Track 1           | `tests/reporting/fleet-presence-reconciliation.test.ts`          |
| Untracked worktree detection in doctor               | Track 1           | `bun test tests/reporting/fleet-presence-reconciliation.test.ts` |
| Empty graph during active execution rejection        | Track 2           | `tests/reporting/planning-dag-integrity.test.ts`                 |
| Tier skip-edge ($\Delta\text{tier} > 1$) rejection   | Track 2           | `bun test tests/reporting/planning-dag-integrity.test.ts`        |
| Live Sentinel doctor blocking & IPC intercept        | Track 2           | `bun test tests/sentinel/live-doctor-sentinel.test.ts`           |
| `dag:check` CLI command registration                 | Track 3           | `bun harness.ts dag:check` exit code 0                           |
| Active mailbox scoping (ignore stale dead mailboxes) | Track 3           | `tests/reporting/mailbox-health-scoping.test.ts`                 |
| Strict 4-tier supervisory dispatch                   | Track 4           | Sentinel cross-tier enforcement                                  |
