# Skill Architecture: Cascading Scope-Aware Replanning & Re-Invocation Protocol

**Document**: `docs/planning/gvui-execution-graph/10-skill-cascading-scope-aware-replanning-protocol.md`  
**Date**: 2026-08-15  
**Status**: Approved Architecture & Locked Planning Specification  

---

## 1. The Critical Failure Mode: Single-Agent Monolithic Collapse

### A. What Breaks at the Late Stage
In long-task execution, the workflow eventually reaches the final phase: **Whole-Run Validation** or the **Completeness Critic**. At this stage, all prior worker agents have concluded, leaving only one agent active.

If this final agent detects compilation errors, failed regression assertions, or missing requirements:
- **The Anti-Pattern (What Was Happening)**: The lone Critic/Validator attempts to modify 10+ files across multiple subsystems itself, attempting to be Implementer, Validator, and Critic simultaneously.
- **The Severe Consequences**:
  1. **Violates Write-Scope Boundaries**: A single agent edits layout math, React components, and CLI scripts simultaneously, introducing cross-module regressions.
  2. **Eliminates Independent Validation**: The agent reviews its own code without adversarial validation.
  3. **Context Window & Single-Thread Bottleneck**: The agent exhausts its context, introduces type errors, and slows execution to a crawl.

---

## 2. The Solution: The Cascading "Fan-Back" Protocol

```
[ASCII Cascading Scope-Aware Replanning & Fan-Back Architecture]

┌────────────────────────────────────────────────────────────────────────────────────────┐
│ LATE STAGE: Completeness Critic / Whole-Run Gate (Single Agent Active)                 │
│ Action: Discovers 3 compiler diagnostics in Drawer + 2 bounding errors in Layout       │
└───────────────────────────────────┬────────────────────────────────────────────────────┘
                                    │ 1. Emits Structured Findings & Rejects Run
                                    │    (DOES NOT EDIT CODE)
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ TIER 2 COORDINATOR: Dynamic Scope Partitioning & Re-Planning                           │
│ Action: Groups findings by `write_scope` and creates dynamic Repair Tasks:             │
│ • Task R-01 (Scope: src/components/EdgeDetailDrawer/)                                  │
│ • Task R-02 (Scope: src/engine/layout/)                                                │
└───────────────────────────────────┬────────────────────────────────────────────────────┘
                                    │ 2. Dispatches Parallel Batch `invoke_subagent`
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ TIER 3: PARALLEL SCOPED REPAIR WAVE (Multiple Agents Re-Invoked Simultaneously)        │
├────────────────────────────────────────────────────┬───────────────────────────────────┤
│ Scope A (Edge Drawer Subsystem)                    │ Scope B (Layout Subsystem)        │
│ ┌────────────────────────────────────────────────┐ │ ┌───────────────────────────────┐ │
│ │ Implementer A: Fixes Drawer Types & JSX        │ │ │ Implementer B: Fixes Clamping │ │
│ └───────────────────────┬────────────────────────┘ │ └───────────────┬───────────────┘ │
│                         ▼                          │                 ▼                 │
│ ┌────────────────────────────────────────────────┐ │ ┌───────────────────────────────┐ │
│ │ Validator A: Runs Drawer Unit & Component Tests│ │ │ Validator B: Runs Layout Gate │ │
│ └────────────────────────────────────────────────┘ │ └───────────────────────────────┘ │
└───────────────────────────────────┬────────────────┴───────────────────────────────────┘
                                    │ 3. Both Scoped Repair Tasks Pass Quality Gates
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ RE-CONVERGENCE: Return to Completeness Critic                                          │
│ Action: Critic re-audits whole-repo git diff against immutable prompt bytes & seals    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Protocol Rules & Invariants

### Rule 1: The Critic / Final Gate "No-Edit" Invariant
- **Rule**: The Completeness Critic and whole-run gate validators are **strictly read-only auditors**. They are **forbidden** from directly editing source code to fix defects.
- **Action on Failure**: When a failure is detected, the Critic generates structured findings mapped to their specific file paths and issues a formal rejection (`critic:reject`), returning control to the Tier 2 Coordinator.

### Rule 2: Deterministic Scope Partitioning (`plan:replan`)
- When receiving a rejection, the Tier 2 Coordinator executes automatic partitioning:
  1. Inspects the file paths touched in each finding.
  2. Groups findings that share the same directory / package into a single `write_scope`.
  3. Registers dynamic repair tasks in the DAG:
     ```bash
     plan:add --task-id repair-T01-drawer --scope "gvui/src/components/EdgeDetailDrawer/" --findings "F-01,F-02"
     plan:add --task-id repair-T02-layout --scope "gvui/src/engine/layout/" --findings "F-03"
     ```

### Rule 3: Mandatory Batch Parallel Re-Invocation
- The Coordinator **MUST** invoke all repair implementer-validator pairs simultaneously in a single batch `invoke_subagent` tool call:
  ```typescript
  invoke_subagent({
    Subagents: [
      { Role: "Repair Implementer: Edge Drawer", Scope: "gvui/src/components/EdgeDetailDrawer/", ... },
      { Role: "Repair Validator: Edge Drawer", Scope: "gvui/src/components/EdgeDetailDrawer/", ... },
      { Role: "Repair Implementer: Layout", Scope: "gvui/src/engine/layout/", ... },
      { Role: "Repair Validator: Layout", Scope: "gvui/src/engine/layout/", ... },
    ]
  });
  ```

### Rule 4: Re-Convergence to Final Gate
- Downstream progression remains blocked until **all** scoped repair tasks pass their respective validation gates.
- Once all repair tasks are approved (`task:review --status pass`), control automatically cascades forward to the Completeness Critic for final verification and capsule sealing (`run:complete`).

---

## 4. Skill Files to Update

To make this behavior universal across all future orchestrations, the following files will be updated:

1. [`agents/critic.yaml`](file:///Users/onurseckinsenoglu/repos/skills/orchestrating-long-tasks/agents/critic.yaml):
   - Add strict **"No-Edit / Fan-Back Invariant"**: Critic must reject and return findings to coordinator; never write code.
2. [`agents/coordinator.yaml`](file:///Users/onurseckinsenoglu/repos/skills/orchestrating-long-tasks/agents/coordinator.yaml):
   - Add **"Dynamic Scope Partitioning & Repair Wave Dispatch"** instructions.
3. [`SKILL.md`](file:///Users/onurseckinsenoglu/repos/skills/orchestrating-long-tasks/SKILL.md) and `~/.agents/skills/orchestrating-long-tasks/SKILL.md`:
   - Add dedicated section: `## Cascading Scope-Aware Replanning & Fan-Back Protocol`.
4. [`references/protocol.md`](file:///Users/onurseckinsenoglu/repos/skills/orchestrating-long-tasks/references/protocol.md):
   - Document state transitions for `critic:reject` $\to$ `plan:replan` $\to$ `task:claim (repair)` $\to$ `critic:review`.
