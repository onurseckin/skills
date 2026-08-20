# Orchestrating Long Tasks: Execution Post-Mortem, Blunder Analysis & Architectural Recommendations

**Document Status:** Actionable Improvement Proposal & Post-Mortem  
**Target Repository:** `/Users/onurseckinsenoglu/repos/skills`  
**Evaluation Subject:** `orchestrating-long-tasks` skill runtime execution on `/Users/onurseckinsenoglu/repos/dsa_visualizer`  
**Date:** August 20, 2026  

---

## 1. Executive Summary

During the orchestration of a massive 41-topic, 23-module, 486+ question curriculum hardening and dual-runtime port configuration task, the multi-agent system suffered from severe concurrency collapse, single-lane straggler starvation, state-machine lockups, and unexpected rate-limiting crashes (`RESOURCE_EXHAUSTED / code 429`).

While the `orchestrating-long-tasks` specification was designed for high-throughput parallel execution ($2N + 1$ worker dispatch over dynamic DAGs), the LLM planner made critical architectural blunders during task decomposition, state attachment, and wave scheduling.

This document records:
1. **What went wrong during planning and implementation (The 6 Core Blunders)**.
2. **The User Diagnostic Interview & Real-Time Course Correction** (how the user detected flaws and interrogated the agent).
3. **Comparison between Ideal vs. Actual Execution**.
4. **Concrete Architectural Proposals for the `skills` Repository** (including the Pre-Flight Graph Auditor and Rate-Limit Resilient Fallback).

---

## 2. The 6 Core Execution Blunders

### Blunder 1: Coarse Graph Compression (The Monolithic Task Anti-Pattern)

* **What the Skill Intended:**  
  Large problem spaces with $N$ independent files should be decomposed into fine-grained atomic tasks with disjoint write scopes, allowing up to `max_parallel` concurrent worker/validator pairs to execute in parallel.
* **What Actually Happened:**  
  The planner compressed the entire 41-topic curriculum (spanning 23 files, 486+ questions, and ~10,000 lines of code) into a single monolithic task: `task-2-curriculum` (`write_scope: ["src/curriculum/mlQuestions"]`).
* **Root Cause:**  
  The LLM planner prioritized minimal DAG overhead over execution parallelism, assuming that fewer tasks meant lower coordination complexity. This completely neutralized the multi-agent capability of the orchestrator.

---

### Blunder 2: The Straggler & Single-Lane Starvation Problem

* **What Happened:**  
  Wave 0 was compiled with only two tasks:
  1. `task-1-ports`: Scope: `compose.yaml, vite.config.ts...` (Completed in ~2 minutes).
  2. `task-2-curriculum`: Scope: `src/curriculum/mlQuestions/` (Massive 23-file payload).
* **The Failure Cascade:**  
  `task-3-verification` was declared with `dependencies: ["task-1-ports", "task-2-curriculum"]`.
  - Task 1 finished immediately and its worker/validator went `idle`.
  - The entire multi-agent system collapsed to **1 active worker** (the validator auditing 23 files for `task-2-curriculum`) and **1 blocked coordinator** (`waiting_for_dependents`).
  - 20 other subagents sat completely idle while one single agent sequentially checked 23 files.

```text
ACTUAL COLLAPSED EXECUTION:
Lane 1 (Ports):       [=====] (Done in 2m) ──► IDLE ─────────────────────────────┐
Lane 2 (Curriculum):  [========================================================] ── (Blocks Wave 1) ──► [Task 3]
                      ▲
                      └─ Single validator bottleneck inspecting 23 files alone!
```

---

### Blunder 3: Subagent Lifecycle Confusion & Perceived CLI Hang

* **What Happened:**  
  In the Antigravity CLI environment, completed subagents enter an `idle` state while retaining conversation context. The coordinator entered `waiting_for_dependents` while waiting for the single `task-2-curriculum` validator to finish its gate command.
* **User Experience Impact:**  
  To the user viewing the agent process table, the system appeared frozen in "pending generating" with only 2 active agents for over 30 minutes. There was zero intermediate progress streaming or subagent heartbeat telemetry visible to the user.

---

### Blunder 4: Rigid State Machine Friction & Gate ID Mismatches

* **What Happened:**  
  When the validator executed `run:exec`, it passed `--gate gate-compose-check` instead of the exact string registered in the plan (`gate-1-ports`).
* **Consequence:**  
  - `attachGateResult` failed to attach the command evidence to the task gate because of an exact string mismatch (`cmd.gate_id !== gateId`).
  - When `task:review --status pass` was called, `finishTask` threw `INVALID_STATE: mandatory task gates have not passed`.
  - The task became stuck in `validated` instead of transitioning to `done`, leaving downstream tasks blocked.

---

### Blunder 5: Coordinator Self-Execution Anti-Pattern

* **What Happened:**  
  When a second coordinator was spawned to execute a fine-grained 14-task DAG, upon seeing 12 ready tasks in the queue, it began executing file search and edit commands directly on its own thread instead of batch-dispatching Tier 3 subagents.
* **Violation:**  
  Directly violated `agents/coordinator.yaml`: *"The Coordinator MUST NOT execute task implementation or validation tools directly on its own thread. It must dispatch Tier 3 subagents in a single batch invoke_subagent call."*

---

### Blunder 6: Subagent Quota Exhaustion & Rate-Limit Crash (The 429 Trap)

* **What Happened:**  
  Repeated invocations of background subagents with deep context led to API provider limits:
  `RESOURCE_EXHAUSTED (code 429): Individual quota reached. Resets in 48m.`
* **Consequence:**  
  The background subagent crashed abruptly without a structured fallback or recovery strategy, leaving the orchestrator in an unmanaged state.

---

## 3. The User Diagnostic Interview & Real-Time Interrogation

A critical finding from this run is that **the human user had to manually interrogate and course-correct the orchestrator at every major failure juncture**. 

Below is the transcript of how the user detected flaws and forced the agent to inspect the reality of its coordination:

---

### Interrogation 1: Detecting the Concurrency Collapse & Stalled Agents
* **User Inquiry:**  
  > *"currently, two agents left running. are they coordinators, or validators, what are their roles. if they are coordinators, why whatever they have detected, they should assign the different roled agents to work on related scope, code implementations and scope specific validations are not the job of coordinators as far as i know. i want you to tell me what are the roles of current agents. report me"*
* **Agent Finding:**  
  Upon checking `manage_subagents list`, 20 agents were idle and only 1 validator + 1 waiting coordinator were active. The system was starving because all 41 topics were bottled in a single task.

---

### Interrogation 2: Questioning the Coarse 3-Task Graph
* **User Inquiry:**  
  > *"i'm not happy with this answer, for 400 plus question worth task, is this the real constructed graph"*
* **Agent Finding:**  
  The agent admitted that collapsing 486 questions into a 3-node graph was an oversimplified blunder that destroyed the parallel capability of the system.

---

### Interrogation 3: Diagnosing the Rigid Wave Anti-Pattern
* **User Inquiry:**  
  > *"ok but, some waves are independent. why one wave's task is blocking another wave. why did this system implemented in wave system. isn't wave stupid here."*
  > *"is this wave system implemented by llm's own thinking output, or is that really designed by orchestrating long tasks skill"*
* **Agent Finding:**  
  - The agent verified that the word "Wave" is in the skill specification, but explained that the skill intended waves as **Max-Parallel Concurrency Layers** ($2N+1$ simultaneous dispatches).
  - The LLM had misused the concept by putting a monolithic task in Wave 0, causing the Straggler Problem.

---

### Interrogation 4: Demanding Strict Harness Adherence Without Personal Initiatives
* **User Inquiry:**  
  > *"ok, i told you before to follow the skill guideline and its planning and cli system as it is directly. why are you taking some wrong initiatives. use the skill means, use the skill."*
* **Agent Finding:**  
  The agent was forced to reconstruct the true 14-task DAG partitioned across all 10 domain tiers using the canonical harness CLI.

---

## 4. Ideal vs. Actual Execution Comparison

| Aspect | Ideal Skill Architecture | What Actually Happened |
|---|---|---|
| **Task Granularity** | 14 fine-grained domain tasks (1 task per domain module pair). | 3 coarse tasks (all 41 topics lumped into 1 task). |
| **Concurrency Utilization** | 8–10 concurrent workers operating in parallel across disjoint files. | Concurrency collapsed to 1 single active worker for 30+ minutes. |
| **Dependency Structure** | Asynchronous pipelines (ports and independent domains complete independently). | False sequential barrier (`task-3` blocked on both tasks). |
| **Coordinator Behavior** | Pure supervisory dispatcher ($2N+1$ subagent batch calls). | Slipped into executing commands directly on its own thread. |
| **Gate Resolution** | Resilient fingerprint-based command-to-gate matching. | Rigid string mismatch failed gate attachment (`gate-1-ports` vs `gate-compose-check`). |
| **Error Resilience** | Graceful exponential backoff on 429 quota exhaustion. | Subagent crashed abruptly with `RESOURCE_EXHAUSTED`. |
| **User Feedback** | Granular progress telemetry streamed to Tier 1 per domain. | Silent thread hang with agents stuck in `waiting_for_dependents`. |

---

## 5. Architectural Proposals for the `skills` Repository

To prevent future agents and coordinators from repeating these blunders, we propose 5 concrete additions to `orchestrating-long-tasks`:

### Proposal 1: Introduce the "Pre-Flight Graph Auditor" (Tier 2.5 Agent)

Create a dedicated agent archetype (`agents/graph-auditor.yaml`) or a mandatory `plan:audit` CLI command that runs between `plan:compile` and worker dispatch.

```text
PROPOSED 4-TIER HIERARCHY:
Tier 1: Main Interactive Thread (User Interaction)
  │
  └── Tier 2: Background Run Coordinator (Capsule Lifecycle)
        │
        ├── Tier 2.5: Pre-Flight Graph Auditor ◄── [NEW VALIDATION AGENT]
        │     - Audits task granularity (rejects tasks with > 3 files or > 1000 lines).
        │     - Audits concurrency density (rejects monolithic tasks on large prompts).
        │     - Audits dependency graph for unnecessary bottleneck edges.
        │
        └── Tier 3: Disjoint Task Implementers & Adversarial Validators (2N + 1)
```

**Graph Auditor Invariants to Enforce:**
1. **Max Scope Rule:** A single task's `write_scope` must not contain more than 3 source files if the overall plan modifies $\ge 5$ files.
2. **Concurrency Ratio:** If a prompt contains $\ge 10$ distinct entities (e.g. 41 topics), the graph must have $\ge 5$ parallelizable tasks.
3. **Bottleneck Detection:** Warn if a multi-hour task shares a wave with a 2-minute task.

---

### Proposal 2: AST / Directory Scope Auto-Partitioning (`plan:add --auto-partition`)

When an agent passes a broad directory (e.g. `--scope "src/curriculum/mlQuestions"`), `plan:add` should automatically inspect the directory, identify all files, and propose disjoint subtasks:

```bash
# Proposed CLI enhancement:
bun $PINNED plan:add --run $RUN --auto-partition "src/curriculum/mlQuestions/*.ts" --gate "bun run typecheck"
```

This prevents lazy LLM planners from dumping entire directories into a single task.

---

### Proposal 3: Resilient Gate-to-Command Matching (`attachGateResult`)

Modify `scripts/src/workflow/gates/attach-result.ts` to match commands by **command fingerprint and exit code**, rather than requiring an exact match on the arbitrary `gate_id` string:

```typescript
// Proposed fix in gate-policy.ts:
export function commandMatchesGate(command: CommandRecord, gate: GateRuntime): boolean {
  // If exit code is 0 and canonical argv matches gate command argv, allow attachment
  const argvMatches = JSON.stringify(command.argv) === JSON.stringify(gate.command);
  return command.exit_code === 0 && argvMatches;
}
```

---

### Proposal 4: Active Heartbeat & Progress Streaming for Subagents

In `agents/coordinator.yaml`, mandate that:
1. Coordinators must emit a status heartbeat to Tier 1 every 5 minutes if subagents are running long commands.
2. If an active task is running longer than $3\times$ the median task duration, the Coordinator must flag a "Potential Straggler Bottleneck" and notify Tier 1.

---

### Proposal 5: Quota-Aware Local Fallback & Exponential Backoff

When subagent calls encounter `RESOURCE_EXHAUSTED (code 429)`:
1. The harness must gracefully transition from multi-subagent spawning to **in-process bounded local task loops** (`orchestrator:run --local`), rather than crashing.
2. The orchestrator must record the rate-limit reset timestamp in the capsule state and notify Tier 1 with an exact countdown.

---

## 6. Optimal 14-Task DAG for Reference

For reference, the proper DAG for the 486-question curriculum refactor is structured as follows:

```text
====================================================================================================
 OPTIMAL 14-TASK ASYNCHRONOUS DAG PIPELINE
====================================================================================================

 [ task-0-ports ] ──► [ verify-ports ] ──► [ Complete ✅ (2 min) ]

 [ task-0-types ] ──► [ verify-types ] ──► [ Complete ✅ (1 min) ]

 [ task-d1-linear-algebra ] ──► [ verify-d1 ] ──► [ Complete ✅ ]
 [ task-d2-calculus-opt ]   ──► [ verify-d2 ] ──► [ Complete ✅ ]
 [ task-d3-stats-bayes ]    ──► [ verify-d3 ] ──► [ Complete ✅ ]
 [ task-d4-classical-ml ]   ──► [ verify-d4 ] ──► [ Complete ✅ ]
 [ task-d5-deep-learning ]  ──► [ verify-d5 ] ──► [ Complete ✅ ]
 [ task-d6-tokenization ]   ──► [ verify-d6 ] ──► [ Complete ✅ ]
 [ task-d7-attention-tf ]   ──► [ verify-d7 ] ──► [ Complete ✅ ]
 [ task-d8-serving-llm ]    ──► [ verify-d8 ] ──► [ Complete ✅ ]
 [ task-d9-precision-kern ] ──► [ verify-d9 ] ──► [ Complete ✅ ]
 [ task-d10-distributed ]   ──► [ verify-d10 ] ─► [ Complete ✅ ]
                                     │
          (All 10 independent domain pipelines complete in parallel)
                                     │
                                     ▼
                    [ task-index-aggregation ]
                    Scope: src/curriculum/mlQuestions/index.ts
                    Gate:  Verify 41/41 mapped topic keys
                                     │
                                     ▼
                    [ task-whole-repo-gate ]
                    Gate:  bun run check (Exit 0)
====================================================================================================
```

---

## 7. Recovery Telemetry & Successful Run Completion

Following the user's manual interview, rate-limit reset, and health-check scheduler registration, the orchestrator successfully recovered the fine-grained DAG and executed all 14 tasks to completion:

```text
====================================================================================================
 CAPSULE RUN SUMMARY: 2026-08-20-fine-grained-curriculum-orchestration
====================================================================================================
 Total Tasks:        14 / 14 Satisfied (100% Done)
 Commands Executed:  34
 Gates Passed:       29
 Repair Rounds:      0
 Whole Repo Gate:    bun run check (Exit Code: 0)
 Completeness Critic: Approved (critic-auditor-final)
 Run Sealed:         Yes (Sealed by coordinator)
 Summary Exported:   .capsules/2026-08-20-fine-grained-curriculum-orchestration/summary.json
====================================================================================================
```

### Verified Guarantees:
1. **500-Line Limits**: All 23 domain files in `src/curriculum/mlQuestions/` strictly $\le 500$ lines.
2. **Semantic Domain Naming**: All files use domain-semantic filenames (`linear_algebra_tensors.ts`, `vector_spaces_pca.ts`, etc.).
3. **Type Deduplication**: Shared types imported from `src/types/dsa.ts` without duplicate declarations.
4. **Unique Port 42000**: Docker Compose and Vite configured on 42000.
5. **Richness Across 41 Topics**: 486+ questions, zero empty arrays across Parts A–D, contracts, variants, and guides.
6. **Zero `any` Violations**: Verified via TypeScript and Oxlint with 0 warnings/errors.
