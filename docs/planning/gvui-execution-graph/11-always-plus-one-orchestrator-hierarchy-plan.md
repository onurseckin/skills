# The "Always +1" Orchestrator Invariant & Main Thread Isolation Architecture

**Document**: `docs/planning/gvui-execution-graph/11-always-plus-one-orchestrator-hierarchy-plan.md`  
**Date**: 2026-08-15  
**Status**: Authoritative Architectural Specification & Skill Standard

---

## 1. Executive Summary & The Problem

### Why Subagents Were Reporting to the Main Thread

In Antigravity and subagent frameworks, when Agent A calls `invoke_subagent` to spawn Agent B, the platform routes all completion messages and lifecycle signals from Agent B **directly back to Agent A**.

- **The Anti-Pattern (What was happening)**: When the Main Interactive Thread (Tier 1) called `invoke_subagent` with 4 worker agents, the platform treated the Main Thread as the direct parent. Every time a worker or validator completed a task, its detailed report was delivered into the Main Thread context, interrupting and cluttering the user conversation.
- **The Solution (The "Always +1" Orchestrator Invariant)**:
  The Main Interactive Thread **NEVER** spawns worker or validator subagents directly.
  The Main Thread spawns **EXACTLY ONE AGENT**: the **Dedicated Tier 2 Orchestrator Agent** (+1 Agent).
  The Tier 2 Orchestrator Agent then spawns all Tier 3 Implementers, Validators, and Critics.
  As a result, **100% of subagent chatter, gate logs, and reports are contained inside the Orchestrator Agent**, leaving the Main Thread completely silent, clean, and responsive to the user.

---

## 2. The "Always +1" Agent Sizing Rule

Regardless of the workload—whether it is a 1-task sequential job or a 6-task parallel wave—the skill strictly enforces the **$N + 1$ Agent Allocation Formula**:

```
+───────────────────────────+───────────────────────────+────────────────────────────────────────────────────────┐
| Task Requirement          | Number of Agents Deployed | Breakdown                                              |
+───────────────────────────+───────────────────────────+────────────────────────────────────────────────────────┤
| 1 Sequential Task         | **2 Agents (1 + 1)**      | • 1 Dedicated Background Orchestrator (Tier 2)         |
|                           |                           | • 1 Scoped Implementer-Validator Subagent (Tier 3)     |
+───────────────────────────+───────────────────────────+────────────────────────────────────────────────────────┤
| 2 Parallel Tasks          | **5 Agents (4 + 1)**      | • 1 Dedicated Background Orchestrator (Tier 2)         |
|                           |                           | • 2 Implementers + 2 Independent Validators (Tier 3)   |
+───────────────────────────+───────────────────────────+────────────────────────────────────────────────────────┤
| 4 Parallel Tasks          | **9 Agents (8 + 1)**      | • 1 Dedicated Background Orchestrator (Tier 2)         |
|                           |                           | • 4 Implementers + 4 Independent Validators (Tier 3)   |
+───────────────────────────+───────────────────────────+────────────────────────────────────────────────────────┤
| N Parallel Tasks          | **2N + 1 Agents**         | • 1 Dedicated Background Orchestrator (Tier 2)         |
|                           |                           | • N Implementers + N Independent Validators (Tier 3)   |
+───────────────────────────+───────────────────────────+────────────────────────────────────────────────────────┤
```

---

## 3. The Strict 3-Tier Multi-Agent Hierarchy

```
[ASCII 3-Tier Multi-Agent Reporting Hierarchy]

┌────────────────────────────────────────────────────────────────────────────────────────┐
│ TIER 1: MAIN INTERACTIVE CHAT (You & Main AI Assistant)                                │
│ • Spawns ONLY the single Tier 2 Orchestrator (+1 agent).                               │
│ • ZERO worker/validator subagents are spawned from this level.                         │
│ • 100% unblocked, silent, and dedicated to interactive user dialogue.                  │
└───────────────────────────────────┬────────────────────────────────────────────────────┘
                                    │ 1. Spawns EXACTLY ONE Orchestrator
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ TIER 2: DEDICATED BACKGROUND ORCHESTRATOR (+1 Dedicated Manager Agent)                 │
│ • Stays active, waits, observes, and coordinates the entire lifecycle.                │
│ • Spawns all Tier 3 Implementers, Validators, and Critics.                             │
│ • Receives and aggregates ALL subagent messages, gate logs, and reports.               │
│ • Executes dynamic scope partitioning and repair waves if validators push back.        │
│ • Executes final whole-run tasks: typechecks, link validation, git commits, sealing.   │
└───────────────────┬────────────────────────────────────────────────┬───────────────────┘
                    │ 2. Spawns Scoped Implementers                  │ 3. Spawns Scoped Validators
                    ▼                                                ▼
┌───────────────────────────────────────┐        ┌───────────────────────────────────────┐
│ TIER 3A: SCOPED IMPLEMENTER SUBAGENTS │        │ TIER 3B: SCOPED VALIDATOR SUBAGENTS   │
├───────────────────────────────────────┤        ├───────────────────────────────────────┤
│ • Task Implementer 1 (Scope A)        │        │ • Independent Validator 1 (Scope A)   │
│ • Task Implementer 2 (Scope B)        │        │ • Independent Validator 2 (Scope B)   │
│ • Task Implementer 3 (Scope C)        │        │ • Independent Validator 3 (Scope C)   │
└───────────────────┬───────────────────┘        └───────────────────┬───────────────────┘
                    │                                                │
                    └─────────────────► ALL REPORTS ◄────────────────┘
                                  (Report ONLY to Tier 2)
```

---

## 4. Late-Stage Finalization & Pushback Handling by Tier 2 Orchestrator

When all Tier 3 tasks complete, the **Tier 2 Orchestrator Agent** acts as the final gatekeeper:

1. **Whole-Repository Type & Linter Verification**:
   - The Orchestrator runs `tsc -b` and linters across the entire workspace.
2. **Late-Stage Pushback & Fan-Back**:
   - If whole-run verification fails or the Completeness Critic discovers missing requirements:
     - The Orchestrator does **NOT** try to fix everything itself.
     - The Orchestrator partitions findings by scope and dispatches a new parallel repair wave of Tier 3 agents.
3. **Capsule Sealing & Conventional Commits**:
   - Once all gates and critic reviews pass:
     - The Orchestrator seals the capsule (`run:complete`).
     - Formats and creates clean conventional commits with zero AI attribution.
4. **Single Milestone Delivery to Tier 1**:
   - The Orchestrator sends **one single final completion message** back to Tier 1 when 100% of the entire run is verified and sealed.

---

## 5. Skill Protocol Rules to Update

This invariant will be integrated directly into:

1. `skills/orchestrating-long-tasks/SKILL.md` and `~/.agents/skills/orchestrating-long-tasks/SKILL.md`:
   - Enforce the **"Always +1" Orchestrator Invariant** as a mandatory rule.
   - Forbid Tier 1 from invoking Tier 3 workers directly.
2. `agents/coordinator.yaml`:
   - Establish Tier 2 Orchestrator lifecycle: child spawning, report aggregation, late-stage typecheck, and single parent notification.
3. `references/protocol.md`:
   - Document the formal 3-tier reporting hierarchy and parent-child isolation boundaries.
