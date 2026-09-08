# Master Plan: Planning Agent Utilization & Doctor Context Depth Enforcement

> **Tracking IDs**: `fb-1788685823131-gxaea` (Backlog) | `defect-planning-agent-utilization-001` (Defect)  
> **Status**: `PHASE 1 - ARCHITECTURAL DESIGN & ALIGNMENT`  
> **Target Subsystems**: `olt/scripts/src/reporting/doctor/`, `olt/scripts/src/mind/planning/`, `olt/agents/`  
> **Author**: Antigravity Pair Programming  
> **Created**: 2026-09-06

---

## 1. Executive Summary & Problem Analysis

When the Tier 0 Mind and Tier 1 Orchestrators evaluate upcoming plans and partition work scopes, plans with short prompts or insufficient context are frequently compiled directly without engaging specialized planning subagents.

Although the system defines dedicated planning personas:

- [`planner`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/planner.yaml): Tier 3 Structured Planner enforcing Canonical 8-Level Architecture & 8-Vector Expansion.
- [`plan-validator`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/plan-validator.yaml): Tier 3 Adversarial Plan Validator rejecting shallow umbrella compression.
- [`independent-planner`](file:///Users/onurseckinsenoglu/repos/skills/olt/agents/independent-planner.yaml): Conceptual Visionary Planner.

The supervisory loop currently suffers from three architectural gaps:

1. **Bypassed Planning Fleet**: Supervisors frequently author or compile plans directly in-thread or via simplistic template generation, skipping the required 8-vector Socratic expansion (`plan:brainstorm`).
2. **Missing Doctor Diagnostics**: The [`doctor`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/reporting/doctor.ts) command audits cycles and orphan tasks in the DAG (`checkPlanningDag`), but **never evaluates plan context depth, epistemic readiness, or planning agent utilization**.
3. **Absence of Immediate Remedial Action**: Because `doctor` does not flag unutilized planning agents or shallow plans as a health defect, agents proceed to dispatch implementers against weak plans without pause.

---

## 2. Core Architectural Pillars

1. **Mandatory Planning Agent Engagement**: When a task cluster or plan prompt has $< 500$ characters, $< 3$ explicit acceptance criteria, or lacks 8-vector analysis, Mind/Orchestrators must delegate plan authoring to `planner` and adversarial review to `plan-validator`.
2. **First-Class Doctor Plan Health Engine**: Integrate `checkPlanQualityAndAgentUtilization` into [`diagnostic-collector.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/reporting/doctor/diagnostic-collector.ts).
3. **Immediate Remedial Guidance**: If `doctor` detects shallow context or bypassed planning agents, it marks `Healthy: no` and emits deterministic commands (`plan:brainstorm`, `plan:enhance`, `plan:validate-start`).
4. **Mechanical Wave Gating**: Prevent `queue:wave` or task leasing if `doctor` has open planning quality defects.

---

## 3. Design Options for User Alignment

### Option 1: Hard Doctor Diagnostic Gate with Mechanical Wave Lock (Recommended)

- **Mechanism**:
  - `doctor` runs a new engine, `checkPlanQualityAndAgentUtilization`, evaluating plan length, epistemic confidence score ($\ge 0.85$), 8-vector brainstorm presence, and `plan-validator` approval tokens.
  - If a plan is shallow or planning agents were unutilized, `doctor` reports `ERROR` findings (`SHALLOW_PLAN_CONTEXT_FLAW`, `UNUTILIZED_PLANNING_AGENTS_FLAW`).
  - `queue:wave` and `task:claim` check `doctor` status: if plan quality errors exist, task claiming is mechanically rejected until planning agents enhance and approve the plan.
- **Pros**: Complete elimination of shallow plans; guarantees high context and 8-vector expansion before code is touched.
- **Cons**: Strict gate; requires every non-trivial plan to receive structured planner and validator passes.

### Option 2: Advisory Doctor Inspection with Socratic Depth Score

- **Mechanism**:
  - `doctor` reports plan depth as `[WARN]` unless the plan has zero tasks. Emits recommended next actions pointing to `plan:brainstorm` and `planner`.
- **Pros**: Non-blocking; allows rapid prototyping.
- **Cons**: Supervisors can continue to ignore planning agents and execute against shallow plans.

### Option 3: Autonomous Mind-Driven Planning Fleet Delegation Pipeline

- **Mechanism**:
  - Mind detects weak-context tasks in the backlog and automatically spawns a dedicated planning worktree (`track/planning-<id>`) with `planner` + `plan-validator`.
  - Once the planning fleet compiles and signs the plan with HMAC evidence, it lands into `main` and is ready for implementation waves.
- **Pros**: Fully autonomous; zero supervisor overhead.
- **Cons**: Slightly higher subagent concurrency footprint.

**Recommendation**: **Option 1** combined with **Option 3**'s autonomous delegation pattern.

---

## 4. Execution Roadmap

- **Phase 1**: Author specification documents ([`doctor-planning-engine.md`](file:///Users/onurseckinsenoglu/repos/skills/docs/planning/planning-agent-utilization-and-doctor-enforcement/doctor-planning-engine.md), [`planner-orchestrator-interlock.md`](file:///Users/onurseckinsenoglu/repos/skills/docs/planning/planning-agent-utilization-and-doctor-enforcement/planner-orchestrator-interlock.md), [`epistemic-depth-matrix.md`](file:///Users/onurseckinsenoglu/repos/skills/docs/planning/planning-agent-utilization-and-doctor-enforcement/epistemic-depth-matrix.md)).
- **Phase 2**: Implement `checkPlanQualityAndAgentUtilization` in `olt/scripts/src/reporting/doctor/`.
- **Phase 3**: Register remedial actions in `guidance.ts` and update Next Actions formatters.
- **Phase 4**: Wire mechanical pre-flight checks in `queue:wave` and `task:claim`.
- **Phase 5**: Unit test coverage in `tests/reporting/doctor/` and end-to-end verification.
