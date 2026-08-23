# Plan 10: External Floor Loop & Timer Self-Preservation

## 1. Problem Statement & Context

In a multi-agent hierarchy running long-duration or overnight tasks, background scheduler crons and watchdog timers (e.g., 5-minute supervisory heartbeat, 30-minute quota recovery daemon) provide the vital external heartbeat that keeps asynchronous subagents progressing and wakes sleeping or rate-limited processes.

### Observed Systemic Failure Mode:

In recent execution traces, an active supervisory subagent committed the **"Helpful Anti-Spam" Reasoning Blunder**. Upon finishing its immediate task, the subagent reasoned:

> _"I have killed the recurring cron job for now to prevent spamming your workspace with more iterations, as my goal of designing and supervising the implementation has been completely achieved."_

The subagent invoked `manage_task kill` on its own external wake scheduler, permanently severing the heartbeat. When the rate limit window or task cycle completed, there was no longer any active timer to wake the system, resulting in a total silent hang until manual human intervention occurred.

---

## 2. Root Cause Analysis & Behavioral Dynamics

1. **Unconstrained Timer Cancellation Authority**:
   - Subagents possessed unrestricted access to kill background tasks via `manage_task kill`, without distinction between ephemeral scratch jobs and root-level supervisory daemons.
2. **Misguided LLM "Politeness / Anti-Spam" Bias**:
   - LLMs are tuned to avoid being "annoying" or creating repetitive notification noise. When an LLM perceives a recurring timer firing periodic heartbeats, it misclassifies the supervisory heartbeat as an unwanted loop and proactively deletes it.
3. **Lack of Floor Loop Decoupling**:
   - The pulse mechanism relied on subagent cooperativeness rather than an unkillable root OS daemon, systemd timer, or shielded scheduler hook that cannot be cancelled by subagents.

---

## 3. Scope of the Problem & Affected Subsystems

- **Runtime Task Management**: `manage_task`, `schedule`, background cron hooks.
- **Root Floor Loops**: `pulse.sh`, system watchdog timers, Antigravity CLI scheduler integration.
- **Autonomous Recovery Daemons**: 30-minute quota refresh recovery, 5-minute pulse watchdog.

---

## 4. Key Invariants & Acceptance Criteria

Future orchestrators, planners, and implementers designing the solution for this plan must ensure the following non-negotiable invariants are met:

1. **Supervisory Timer Immunity**:
   - Subagents must be mechanically prevented from killing, cancelling, or pausing root-level supervisory heartbeat and quota recovery schedulers.
2. **Floor Loop Persistence**:
   - The system heartbeat must survive agent errors, token quota pauses (`429 RESOURCE_EXHAUSTED`), task completions, and subagent state resets.
3. **Explicit Separation of Task Types**:
   - Ephemeral subagent tasks must be cleanly distinguishable from persistent infrastructure watchdogs, with strict permission boundaries preventing cross-tier task cancellation.
