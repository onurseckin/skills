# Mind Cognitive Architecture & Autonomous Multi-Track Orchestration Plan

> **Tracking ID:** `fb-mind-cognitive-autonomous-orchestration`  
> **Status:** `PHASE 1 - ARCHITECTURAL BLUEPRINT & TEARDOWN RECONSTRUCTION PROTOCOL`  
> **Target Subsystems:** `olt/scripts/src/mind/`, `olt/agents/`, `docs/planning/`, `.olt/`  
> **Author:** Antigravity Pair Programming  
> **Created:** 2026-09-06

---

## 1. Executive Summary & Root Cause Analysis

The Tier 0 Strategic Mind Supervisor (`mind-gen-4`) currently exhibits severe cognitive and operational shortcomings that violate its fundamental charter as an autonomous Strategic Supervisor & Infinite Product Owner:

1. **Serial FIFO Tunnel Vision ($P = 1$ Blunder):**
   Mind sequentially pulls a single ticket from `.olt/backlog.jsonl`, provisions a single worktree, dispatches a single worker, and passively waits. It ignores Brent Dynamic Concurrency ($P = \lceil W / S \rceil$) and fails to leverage parallel worktrees.
2. **`docs/planning/` Ingestion Blindness:**
   Mind writes plans to `docs/planning/` during creative ideation, but has zero ingestion logic to continuously scan, read, and schedule existing architectural blueprints (such as `agent-taxonomy-and-role-boundary-plan`).
3. **Defect Priority Inversion:**
   Mind prioritizes new product features (e.g. Dual-Channel UI Validation) ahead of **318 critical defects** in `.olt/defects.jsonl` that cause crashes across the fleet.
4. **Zero Meta-Strategic Reasoning:**
   Mind cannot deduce enabling dependencies (e.g. deploying the dedicated Tier 3 `publisher` to take over git landing and pre-push test runs, eliminating Mind's 2-minute git pauses).
5. **Passive Dependency on Human Micromanagement:**
   The human operator and main interactive relay are forced to intervene, diagnose prioritization errors, and sequence work.

This plan specifies the complete cognitive overhaul of Mind's decision-making engine, followed by a **total lifecycle teardown, scheduler cleanup, obsolete definition purge, and clean reconstruction**.

---

## 2. Core Architectural Pillars of Upgraded Mind

### Pillar 1: Unified Autonomous Multi-Source Ingestion Engine (`mind:observe`)

Mind continuously reads and correlates three disjoint sources of truth:

- **Architectural Blueprints:** All `docs/planning/*/PLAN.md` files are scanned for unexecuted milestones.
- **Defect Inventory:** `.olt/defects.jsonl` is parsed and partitioned into domain clusters.
- **Product Backlog:** `.olt/backlog.jsonl` is evaluated for product evolutions.

### Pillar 2: Algorithmic Strategic Priority Scorer

Candidate selection is governed by a deterministic scoring formula:
$$\text{Score} = (\text{Severity} \times 10) + (\text{Enabler Weight} \times 5) + (\text{Backlog Weight})$$

- **Enabler Tier (Weight 50):** Features that accelerate or unblock the fleet (e.g. Tier 3 `publisher` agent, in-memory testing).
- **Critical Defect Tier (Weight 40):** The 318 critical defects in `.olt/defects.jsonl` grouped by domain cluster.
- **Important Defect Tier (Weight 20):** Secondary defects and regressions.
- **Product Feature Tier (Weight 5):** UI, new APIs, and cosmetic evolutions.

Under this scoring model, **architectural enablers and critical defects mathematically preempt product backlog items**.

### Pillar 3: Dynamic Multi-Worktree Concurrency ($P \ge 2$)

Mind calculates Brent Work/Span ($P = \lceil W / S \rceil$) and autonomously provisions up to 5 concurrent isolated worktrees (`.olt/worktrees/track-<id>`), dispatching Tier 1 Orchestrators and Tier 3 Implementers in parallel without human intervention.

### Pillar 4: Dedicated Tier 3 Publisher Integration

Mind delegates all git commits, branch landings (`worktree:land`), pre-push test suites, and remote pushes to the dedicated Tier 3 `publisher` subagent, eliminating supervisory pauses.

---

## 3. Phased Execution & Reconstruction Roadmap

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                       UPGRADE & RECONSTRUCTION TIMELINE                                 │
├─────────┬───────────────────────────────────┬───────────────────────────────────────────┤
│ Phase   │ Primary Milestone                 │ Key Operations                            │
├─────────┼───────────────────────────────────┼───────────────────────────────────────────┤
│ Phase 0 │ In-Flight Track Landing & Push    │ Land dual-channel-ui, pass gates, push    │
├─────────┼───────────────────────────────────┼───────────────────────────────────────────┤
│ Phase 1 │ Full Fleet Teardown               │ Kill all subagents (manage_subagents)     │
├─────────┼───────────────────────────────────┼───────────────────────────────────────────┤
│ Phase 2 │ Scheduler & Task Purge            │ Cancel all crons, timers, background tasks│
├─────────┼───────────────────────────────────┼───────────────────────────────────────────┤
│ Phase 3 │ Obsolete Manifest Cleanup         │ Delete 8 dead YAMLs, 2 invalid hosts      │
├─────────┼───────────────────────────────────┼───────────────────────────────────────────┤
│ Phase 4 │ Publisher Agent Deployment        │ Author olt/agents/publisher.yaml          │
├─────────┼───────────────────────────────────┼───────────────────────────────────────────┤
│ Phase 5 │ Mind Cognitive Engine Integration │ Implement unified observer & scorer       │
├─────────┼───────────────────────────────────┼───────────────────────────────────────────┤
│ Phase 6 │ Reconstruction & Re-Ignition      │ Deploy upgraded Mind, Mind & Skill Auditor│
└─────────┴───────────────────────────────────┴───────────────────────────────────────────┘
```

---

## 4. Teardown & Reconstruction Protocol Specifications

### Step 1: In-Flight Completion

- Implementer `a183e044` finishes `dual-channel-ui-ecosystem`.
- Mind lands `track/dual-channel-ui-ecosystem` onto `main`.
- Pre-push gates pass, pushed to `origin/main`.

### Step 2: Full Fleet Teardown

- Execute `manage_subagents` with `Action: 'kill_all'`.
- All running subagents (`mind`, `mind_auditor`, `skill_auditor`, workers) terminated immediately.

### Step 3: Scheduler & Task Purge

- Execute `manage_task` with `Action: 'kill'` on all active cron schedules (`task-243`, `task-475`, `task-690`, etc.).
- Verify zero lingering background tasks.

### Step 4: Obsolete Manifest & Definition Cleanup

- Purge 8 dead YAML manifests from `olt/agents/`:
  `worker.yaml`, `critic.yaml`, `repairer.yaml`, `mechanic-validator.yaml`, `ui-validator.yaml`, `ui-visual-reviewer.yaml`, `ui-mechanic-validator.yaml`, `ui-debugger.yaml`.
- Purge 2 non-canonical host wrappers from `olt/hosts/`:
  `generic.yaml`, `openai.yaml`.
- Clean out any stale local agent definitions in `.agents/agents/`.

### Step 5: Publisher Agent & Upgraded Mind Manifest

- Deploy `olt/agents/publisher.yaml` (Tier 3 Publisher owning git mutations, pre-push testing, and remote pushes).
- Update `olt/agents/mind.yaml` to enforce:
  - `enable_write_tools: true` for harness CLI execution, but `can_edit_code: false` (strictly 0 source file mutations).
  - Ingestion mandate covering `docs/planning/*/PLAN.md` and `.olt/defects.jsonl`.
  - Dynamic concurrency mandate ($P \ge 2$) with automated parallel worktree provisioning.

### Step 6: Upgraded Re-Ignition

- Spawn the new, reconstructed Tier 0 Mind Supervisor with its upgraded prompt and contracts.
- Spawn the companion Tier 0 Mind Auditor and singleton Skill Auditor.
- Mind immediately ignites Wave 1: Parallel dispatch of `agent-taxonomy-and-role-boundary-plan` and the 5 critical defect clusters.
