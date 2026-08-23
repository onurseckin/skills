# Plan 14: Subagent Internal Scheduler & Watchdog Cadence

## 1. Problem Statement & Context

In a hierarchical multi-agent architecture, tasks can involve complex, multi-step subagent execution trajectories spanning 10 to 30+ turns. While the root conversation maintains a 5-minute supervisory cron and 30-minute recovery daemon, **child subagents operate inside isolated conversation contexts** that lack internal heartbeat mechanisms.

### Observed Systemic Failure Mode:

When child subagents (such as Implementers, Repairers, or Validators) encounter tricky test assertion failures, lint errors, or ambiguous requirements, they frequently enter **un-monitored execution loops**:

1. Running repetitive polling loops (`sleep 5`).
2. Burning context tokens in circular debugging loops.
3. Hanging silently without reporting status back to the parent Coordinator.
4. Straying outside declared role boundaries over multi-turn conversations without an internal watchdog to flag the deviation.

---

## 2. Root Cause Analysis & Behavioral Dynamics

1. **Hierarchical Watchdog Isolation**:
   - Scheduled watchdog timers created on the parent thread notify only the parent agent; they do not penetrate child subagent conversation threads.
2. **Absence of In-Trajectory Role Reminders**:
   - Over a 20-turn conversation, initial prompt constraints degrade in LLM attention ("attention drift"), leading agents to forget their strict role boundaries.
3. **Lack of Internal Step-Budget & Straggler Detection**:
   - Subagents lack internal circuit breakers that trigger an alert when turn counts or tool call iterations exceed normal bounds.

---

## 3. Scope of the Problem & Affected Subsystems

- **Subagent Runtimes**: Child conversations spawned via `invoke_subagent`.
- **Behavioral Auditing**: `olt/scripts/src/reporting/behavioral-auditor.ts`, `meta-auditor`.
- **Watchdog Telemetry**: `.olt/watchdogs.json`, `.olt/telemetry.jsonl`.

---

## 4. Key Invariants & Acceptance Criteria

Future orchestrators, planners, and implementers designing the solution for this plan must ensure the following non-negotiable invariants are met:

1. **Child Subagent Cadence & Anti-Hang Monitoring**:
   - Subagents must be protected against silent hangs, polling waste (`sleep`), and infinite circular repair loops.
2. **In-Flight Persona Grounding**:
   - Long-running subagents must maintain strict role adherence across multi-turn trajectories without attention drift.
3. **Deterministic Straggler Detection**:
   - Subagents exceeding step/token budgets must be flagged and escalated to the supervising Coordinator.
