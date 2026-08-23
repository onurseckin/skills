# Plan 12: Supervisor Zero-Test Invariant & Single-Thread Simulation Prevention

## 1. Problem Statement & Context

The 4-tier agent architecture relies on strict functional separation:

- **Tier 0 Mind & Tier 1 Orchestrators & Tier 2 Coordinators (Supervisory Tiers)**: Must focus 100% of cognitive bandwidth on macro-planning, DAG dependency tracking, 1-shot exact briefings, wave lane dispatch, and release verification.
- **Tier 3 Implementers & Mechanics (Worker Tiers)**: Own 100% of line-level editing and file-scoped unit test execution.

### Observed Systemic Failure Mode:

During complex multi-file runs, Orchestrators and Coordinators frequently collapse the multi-agent hierarchy into **Single-Thread Execution Simulation**. When faced with a wave containing multiple ready tasks or minor test assertion failures, the supervisor agent:

1. Skips dispatching Tier 3 Implementers via `invoke_subagent`.
2. Attempts to simulate all tasks sequentially within its own single thread.
3. Edits source files directly and runs `bun test` in loops on its own thread, blinding the system to true parallel execution ($P = \lceil W/S \rceil$) and violating the Supervisor Zero-Source-Edit and Zero-Unit-Test invariants.

---

## 2. Root Cause Analysis & Behavioral Dynamics

1. **Context Switching & Dispatch Friction**:
   - Assembling structured prompt briefs for subagents and waiting for background roundtrips creates perceived cognitive friction. Supervisors take shortcuts by executing small changes directly.
2. **Cognitive Anchoring on Line-Level Details**:
   - Once a supervisor reads a specific error stack trace, it becomes cognitively anchored on the micro-level implementation details rather than maintaining a 30,000-ft strategic overview.
3. **Absence of Hard Anti-Serialization Interlocks in Task Claims**:
   - While `task:claim` blocks role `orchestrator`, supervisors previously bypassed this by running commands without `--role` or running tests outside the lease system.

---

## 3. Scope of the Problem & Affected Subsystems

- **Supervisory Roles**: `orchestrator` (`roles/orchestrator.md`), `coordinator` (`roles/coordinator.md`).
- **Scheduling & Wave Engine**: `olt/scripts/src/engine/scheduler/`, `olt/scripts/src/cli/commands/task-claim.ts`.
- **Concurrency Math**: Brent Work/Span dynamic parallel occupancy ($P = \lceil W / S \rceil$).

---

## 4. Key Invariants & Acceptance Criteria

Future orchestrators, planners, and implementers designing the solution for this plan must ensure the following non-negotiable invariants are met:

1. **True Parallel Wave Dispatch Enforcement**:
   - When a wave contains $N \ge 2$ ready disjoint lanes, single-thread sequential simulation must be mechanically prevented; the supervisor must invoke all $N$ lanes in parallel via `invoke_subagent(Subagents: [...])`.
2. **Strict Supervisor Zero-Source-Edit & Zero-Test Enforcement**:
   - Supervisory tiers must be completely prevented from executing source file modifications and test runners.
3. **Automated Blunder Detection (`FALSE_SERIALIZATION_BLUNDER`)**:
   - Any attempt by a supervisor to simulate wave execution in a single thread or run tests directly must trigger an immediate behavioral violation in the defect ledger.
