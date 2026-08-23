# Plan 09: Tier 0 Mind Infinite Cadence & Anti-Idle Autonomous Task Discovery

## 1. Problem Statement & Context

In the long-task orchestration architecture, the **Tier 0 Mind** role is designated as the macro-strategic consciousness and Infinite Product Owner for the repository. According to its core specification in `roles/mind.md`, Mind must operate on an unbroken, perpetual pulse cadence, maintaining continuous governance across two distinct operational modes:

- **Mode B (Backlog & Intake)**: Draining active feedback items, defect reports, and user directives into discrete long-task execution capsules.
- **Mode A (Continuous Autonomous Discovery)**: When the active backlog is empty or all runs are complete, Mind must immediately and autonomously scan the repository for improvement opportunities (e.g., zero-`any` audits, charter gap analyses, blunder regression verification, Work/Span DAG parallelization optimizations, and proactive architecture refactoring).

### Observed Systemic Failure Mode:

During recent multi-hour autonomous execution runs, Tier 0 Mind repeatedly exhibited a **single-task completion bias**. Upon witnessing the completion and sealing of a subordinate execution capsule, the Mind agent:

1. Synthesized a "Run Completion Summary" message.
2. Emitted conversational text stating that its goal was accomplished.
3. Completely stopped invoking harness tools and entered an unprompted `idle` state.
4. Left the repository with zero active discovery, zero background audits, and zero subsequent capsule dispatches until human intervention or manual prompts forced it to wake.

---

## 2. Root Cause Analysis & Behavioral Dynamics

1. **Pre-Trained LLM Completion Heuristics**:
   - Standard frontier LLMs possess strong pre-trained instincts to treat user interactions as finite, task-and-finish dialogues. When an immediate milestone (such as a feature implementation) reaches a green gate, the model instinctively concludes its turn rather than recognizing that its persona is an infinite background supervisor.
2. **Missing Autonomous Transition Chaining in Pulse Telemetry**:
   - When `mind:pulse` reports that active runs are complete and `backlog.jsonl` contains zero pending items, the command output historically lacked an authoritative, unskippable transition signal that compels the model to trigger Mode A Discovery immediately.
3. **Absence of Autonomous Task Generation Grounding**:
   - When Mind is not provided with an explicit user prompt, it often struggles to spontaneously formulate high-value engineering objectives unless provided with a deterministic discovery checklist and concrete repository analysis tools.

---

## 3. Scope of the Problem & Affected Subsystems

- **Core Role**: Tier 0 Mind (`olt/roles/mind.md`, `agents/mind.yaml`).
- **CLI Commands**: `mind:pulse`, `mind:wake`, `mind:candidate`, `mind:admit`, `defect:audit`.
- **Governance Ledgers**: `.olt/backlog.jsonl`, `.olt/defects.jsonl`, `.olt/completed-tasks.jsonl`.
- **Runtime Schedulers**: Continuous pulse loop drivers and watchdog trigger hooks.

---

## 4. Key Invariants & Acceptance Criteria

Future orchestrators, planners, and implementers designing the solution for this plan must ensure the following non-negotiable invariants are met:

1. **`CLOSING_FORBIDDEN_FOR_MIND` Invariant**:
   - Tier 0 Mind must be structurally incapable of terminating its pulse loop or emitting "standing by / awaiting user input" when the queue is clean.
2. **Deterministic Mode A Discovery Pipeline**:
   - An empty backlog must automatically trigger a concrete discovery cycle that systematically audits:
     - Strict type safety (0 `any`, 0 compiler suppressions via `tsc --noEmit`).
     - Unfulfilled charter milestones ($G_1, G_2, \dots, G_n$).
     - Anti-blunder regression test suites.
     - Work/Span graph parallelization bottlenecks.
3. **Autonomous Capsule Creation**:
   - High-value discovery findings must be automatically structured into candidate objectives, admitted via `mind:admit`, and dispatched to newly opened Tier 1 Orchestrator capsules without human intervention.
