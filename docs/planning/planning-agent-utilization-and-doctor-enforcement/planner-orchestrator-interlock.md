# Planner-Orchestrator Interlock & Delegation Contracts

> **Subsystem**: `olt/agents/`, `olt/scripts/src/mind/planning/`  
> **Related Roles**: [`mind`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/mind.yaml), [`orchestrator`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/orchestrator.yaml), [`planner`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/planner.yaml), [`plan-validator`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/plan-validator.yaml)

---

## 1. The Anti-Supervisory Planning Invariant

**Rule**: Supervisors (Tier 0 `mind` and Tier 1 `orchestrator`) are strategic coordinators, not technical planners.

- They are strictly prohibited from authoring task definitions, creating mock gates, or compiling graph topologies directly in their own execution threads.
- When an incoming user request, backlog item, or defect cluster requires implementation, supervisors must delegate Phase 1 plan authoring directly to a leased Tier 3 `planner` subagent.

```text
User / Backlog / Defect
           │
           ▼
Tier 0 Mind / Tier 1 Orchestrator
           │
           ├─► Detects Context Depth (< 500 chars or < 3 acceptance criteria)
           │
           ▼
[Delegation Trigger] ──► Spawns Tier 3 Planner (planner_<phase>)
                                │
                                ├─► plan:brainstorm (8-vector Socratic expansion)
                                ├─► plan:enhance (AST & repo discovery)
                                ├─► plan:add (disjoint scopes, line coordinates)
                                ├─► plan:compile (DAG revision 1)
                                │
                                ▼
                       Spawns Tier 3 Plan-Validator (plan-validator_<phase>)
                                │
                                ├─► plan:validate-start
                                ├─► plan:audit (A1-A8 checks, anti-umbrella check)
                                └─► plan:review (approval token minted)
                                │
                                ▼
                       2-Key Plan Sealed ──► Ready for Wave Execution
```

---

## 2. Thresholds for Mandatory Planning Agent Invocation

An incoming request or backlog cluster MUST trigger dedicated `planner` dispatch if ANY of the following conditions are met:

1. **Short Prompt Threshold**: Prompt length $< 500$ characters.
2. **Ambiguous Context**: Requirement lines lack exact file or line coordinate targets.
3. **Multi-Domain Scope**: Cluster touches $\ge 2$ directories or files.
4. **Defect Clustering**: Any cluster bundling $\ge 2$ defects or backlog items.
5. **Missing Gate Specifications**: Prompt does not supply explicit, runnable test commands (`bun test <path>`).

---

## 3. The 2-Key Plan Sealing Protocol

Execution of implementation tasks is mechanically prevented until two independent cryptographic tokens exist in the capsule ledger:

1. **Key 1: Planner Signature (`PLAN_COMPILED_BY_PLANNER`)**:
   - Issued upon `plan:compile` executed by an authenticated `planner` role token.
   - Embeds the SHA-256 hash of the compiled graph topology.
2. **Key 2: Adversarial Validator Token (`PLAN_REVIEWED_BY_VALIDATOR`)**:
   - Issued upon `plan:review --status pass` executed by an authenticated `plan-validator` role token.
   - Enforces zero unreviewed dependency edges and zero unreviewed per-task gates.

---

## 4. Worktree Isolation for Planning Fleets

For large feature tracks ($P \ge 2$), planning fleets run in an isolated worktree (`.olt/worktrees/planning-<track>`) to inspect repository files and test fixtures without interfering with active worker lanes in the root workspace.
