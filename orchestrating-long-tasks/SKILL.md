---
name: orchestrating-long-tasks
description: Use when a request is long-running, spans multiple files or subsystems, needs parallel agents, must survive restarts or context loss, or requires independent validation and bounded repair before completion.
---

# Orchestrating Long Tasks

Turn a large prompt into a durable, graph-scheduled, independently validated run. The harness keeps
authoritative coordination under `.capsules/<run>/`, stores lightweight, verifiable state artifacts,
and can be resumed by Codex, ChatGPT coding agents, Claude Code, or Antigravity without relying
on conversation history or model-provider APIs.

This guide serves as the **high-level orchestrator manual** directing orchestrators on how to leverage the specialized agent configurations under `agents/` and detailed protocol references under `references/`.

---

## Specialized Agent Archetypes (`agents/`)

The harness partitions responsibilities across four distinct agent archetypes defined under `agents/`:

| Agent Spec                                           |  Tier  | Role & Responsibilities                                                                                                                                                                                                                                                                              |
| :--------------------------------------------------- | :----: | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`agents/coordinator.yaml`](agents/coordinator.yaml) | Tier 2 | **Long Task Coordinator**: Owns capsule lifecycle, prompt capture, graph compilation, concurrency wave management, heartbeat tracking, and run completion. Dispatches Tier 3 workers and validators in the background.                                                                               |
| [`agents/worker.yaml`](agents/worker.yaml)           | Tier 3 | **Task Worker**: Implements features strictly within assigned `write_scope`, conducts local pre-submission testing (unit/integration/negative tests), and resolves validator findings during repair rounds.                                                                                          |
| [`agents/validator.yaml`](agents/validator.yaml)     | Tier 3 | **Adversarial Validator**: Executes mandatory gate proof commands via `run:exec`, performs adversarial invariant audits (edge cases, contract boundaries, layout math, negative assertions, visual layout bounds), and issues formal structured pushbacks (`task:reject`) or passes (`task:review`). |
| [`agents/critic.yaml`](agents/critic.yaml)           | Tier 3 | **Completeness Critic**: Evaluates whole-repository git diff against original immutable prompt bytes, audits requirement coverage, verifies run completion gates, and issues final sign-off (`critic:review`).                                                                                       |
| [`agents/openai.yaml`](agents/openai.yaml)           |   —    | **OpenAI / Codex Profile**: System interface definition for OpenAI Codex and ChatGPT coding agent environments.                                                                                                                                                                                      |

---

## Specialized Reference Manuals (`references/`)

Deep technical documentation and operational contracts are available under `references/`:

- [`references/protocol.md`](references/protocol.md): Non-negotiable invariants, immutable prompt capture, role packet sanitization, and gate execution rules.
- [`references/cli.md`](references/cli.md): Comprehensive syntax reference for all 18 colon-based CLI subcommands (`plan:*`, `queue:*`, `task:*`, `run:*`, `critic:*`).
- [`references/state-model.md`](references/state-model.md): Run directory structure, task state transitions, lease/recovery mechanics, and event stream integrity.
- [`references/host-adapters.md`](references/host-adapters.md): Two-tier agent architecture, main-thread isolation, and host-native subagent adapters for AGY, Claude Code, and Codex.
- [`references/failure-modes.md`](references/failure-modes.md): Complete failure mode taxonomy (stale leases, worker crashes, scope collisions, gate mismatches) and deterministic recovery strategies.
- [`references/parity-matrix.md`](references/parity-matrix.md): Host capability parity matrix across AI agent execution platforms.
- [`references/schema-examples.md`](references/schema-examples.md): Canonical JSON schemas for requirements, DAG graphs, submissions, findings, and reviews.

---

## Mandatory Multi-Agent Dispatch Invariant

When running long-task execution waves, the coordinator MUST dispatch all concurrent implementers and validators simultaneously using a **single batch `invoke_subagent` tool call**:

```typescript
// Correct: True parallel multi-agent dispatch in a single tool call
invoke_subagent({
  Subagents: [
    { Role: "Implementer 1 (Task T-01)", TypeName: "self", Prompt: "..." },
    { Role: "Validator 1 (Task T-01)",   TypeName: "self", Prompt: "..." },
    { Role: "Implementer 2 (Task T-02)", TypeName: "self", Prompt: "..." },
    { Role: "Validator 2 (Task T-02)",   TypeName: "self", Prompt: "..." },
  ]
});
```

- **NEVER** run a single subagent loop to execute multiple tasks sequentially.
- **NEVER** block the Tier 1 main chat; subagents must run in the background and report strictly to the orchestrator.

---

## When to use


Use this skill when any of these are true:

- the prompt contains many instructions, files, phases, or acceptance criteria;
- two or more independent work lanes can run concurrently;
- implementation needs adversarial review, repair loops, or mandatory gates;
- the task may outlive one context window, process, client, or agent;
- repository changes must be isolated among multiple agents;
- command hangs, transient network failures, or stale workers need deterministic recovery.

Do not create a harness for a simple answer, a one-file mechanical edit, or a short diagnostic that
one agent can finish and verify directly.

---

## Hard rules

1. Preserve the user's complete prompt as immutable bytes before summarizing or planning it.
2. Never treat agent prose as authoritative state or proof.
3. Never let an implementer validate its own work or feed its report into a validator packet.
4. Never dispatch overlapping write scopes in parallel.
5. Never mutate a run with an unauthenticated external tool; dispatch mutations strictly through the harness CLI.
6. Never call a model API or launch an LLM CLI. Dispatch only through the current host's native subagent mechanism.
7. Never announce completion while the runtime reports a blocker.
8. Describe mandatory gate evidence only as `trusted_host_observed_v1`, never as hermetic, sealed, or sandboxed.
   Packet Git commands and the accepted Git diff gates use one restricted command seam that disables
   hooks, pathname fsmonitor, replacement objects, pagers, external diff, and text conversion.
   Repository discovery rejects repository-local `diff.external`, `diff.*.textconv`, active
   `core.fsmonitor`, or `filter.*.clean`, `filter.*.smudge`, or `filter.*.process` before status.

---

## Orchestrator Guidance: Multi-Agent Dispatch & Adversarial Validation

### 1. Two-Tier Agent Architecture & Main Thread Isolation

To keep the user's interactive conversation clean, responsive, and free of worker tool churn, adhere strictly to the 3-tier hierarchy:

1. **Tier 1 (Main Interactive Thread)**:
   - Dedicated exclusively to user interaction.
   - Spawns **exactly one** child: the `Background Run Coordinator`.
   - Never runs implementer/validator tool loops or background polls directly.
2. **Tier 2 (Background Run Coordinator)**:
   - Owns capsule lifecycle, planning, waves, and validation.
   - Spawns and manages all Tier 3 workers in the background tree.
   - Reports to Tier 1 parent **only at major milestones** (Plan Ready, Wave Complete, Escalation, Final Sign-off).
3. **Tier 3 (Worker & Validator Subagents)**:
   - Ephemeral executors assigned disjoint write scopes.
   - Message and report exclusively to the Tier 2 Coordinator.

See [references/host-adapters.md](references/host-adapters.md) for adapter implementations across Antigravity, Claude Code, and Codex.

### 2. Context Sanitization & Independent Validation

Self-grading and conversational bias lead to unhandled edge cases, missing assertions, and overlooked defects. The harness enforces **Adversarial Role Separation**:

- **Context Sanitization**: When a worker submits a task via `task:submit`, implementer prose and subjective confidence claims are completely stripped from the validator's packet.
- **Pure Allowlisted Context**: The validator receives only immutable prompt requirements, acceptance criteria, write scope, changed file paths, physical git diff, and mandatory gate command contracts.

### 3. Adversarial Invariant Audits & Visual/Layout Checks

The coordinator must direct Tier 3 validators to perform rigorous, multi-round adversarial verification:

- **Mandatory Gate Execution**: Execute test suites via `run:exec` under process monitoring and verify exit code 0.
- **Contract & Boundary Stress-Testing**: Test boundary conditions, input extremes (empty collections, maximum byte buffers, invalid unicode), and type contracts.
- **Negative Assertions & Error Handling**: Prove that unauthorized requests, invalid arguments, and failure conditions are explicitly tested and cleanly handled.
- **Visual & Layout Audits on Generated Artifacts**: For generated UI components, HTML/CSS layouts, SVGs, or documentation:
  - Verify responsive constraints, layout coordinates, non-overlapping containers, and bounding box math.
  - Verify typography tracking, WCAG accessibility attributes (ARIA roles, semantic elements, color contrast), and zero text clipping.
  - Verify that no placeholder text, mock stubs, or unlinked artifacts remain.
- **Substantive Test Audit**: Reject tautological, empty, or mocked-out tests that bypass actual business logic.

### 4. Structured Pushback (`task:reject`) & Bounded Repair Loops

When any invariant check fails or tests are incomplete:

1. **Formal Pushback**: The validator executes `task:reject` with structured findings (`--reason`, `--finding`, `--evidence`).
2. **Targeted Repair**: The task transitions to `changes_requested`. The coordinator routes the finding back to the worker for targeted remediation within `write_scope`.
3. **Re-Verification in Round 2+**: A fresh validator verifies the fix against prior findings, re-runs `run:exec`, re-checks all invariants, and only approves via `task:review --status pass` when completely satisfied.
4. **Bounded Escalation**: If a task fails across max repair rounds (default 5, configurable via `max_repair_rounds`), the harness transitions the task to `escalated` and alerts the coordinator/user.

---

## Standard CLI & API Protocol

The harness CLI provides colon-based domain commands that output concise markdown briefs (<= 30 lines)
for direct agent consumption with zero raw JSON authoring required:

```text
PINNED=orchestrating-long-tasks/scripts/harness.ts
RUN=.capsules/<slug>
```

### Phase 1: Planning & Compilation

Initialize the capsule with exact prompt capture:

```bash
printf "%s" "$PROMPT" | bun $PINNED plan:init --repo . --run <slug> --prompt-stdin
```

Register modular tasks with disjoint write scopes:

```bash
bun $PINNED plan:add --run $RUN --id <task-id> --label "<label>" --scope <path> --gate "<gate-cmd>" [--deps <dep-id>]
```

Check plan status and compile the dependency graph:

```bash
bun $PINNED plan:status --run $RUN
bun $PINNED plan:compile --run $RUN --actor planner
```

`plan:compile` automatically performs atomic prompt decomposition, line-by-line coverage analysis,
scope independence validation, and graph construction.

### Phase 2: Queue Management & Concurrency

Inspect ready and partitioned tasks:

```bash
bun $PINNED queue:next --run $RUN
bun $PINNED queue:list --run $RUN
```

Pop the highest-priority task and lease it to a worker:

```bash
bun $PINNED queue:pop --run $RUN --agent <worker-id> --lease-seconds 1800
```

### Phase 3: Task Implementation & Review Lifecycle

Claim, heartbeat, and submit implementation:

```bash
# Claim explicit task (or use queue:pop)
bun $PINNED task:claim --run $RUN --task <task-id> --agent <worker-id>

# Heartbeat active lease during work
bun $PINNED task:heartbeat --run $RUN --task <task-id> --agent <worker-id> --token <token>

# Submit work when ready
bun $PINNED task:submit --run $RUN --task <task-id> --agent <worker-id> --token <token> --summary "<summary>"
```

Independent Validation & Review:

```bash
# Start independent validation (dispatches validator packet)
bun $PINNED task:validate-start --run $RUN --task <task-id> --validator <val-agent>

# Validator executes the mandatory gate command under monitoring
bun $PINNED run:exec --run $RUN --task <task-id> --gate <gate-id> --actor <val-agent> -- <gate-argv...>

# Record validation approval (automatically attaches gates and satisfies task)
bun $PINNED task:review --run $RUN --task <task-id> --validator <val-agent> --token <token> --status pass --summary "<summary>"

# Or reject with findings for implementer repair
bun $PINNED task:reject --run $RUN --task <task-id> --validator <val-agent> --token <token> --reason "<reason>" --finding "<remediation>" [--evidence <cmd-id>]
```

### Phase 4: Completeness Critic & Lifecycle Completion

Run final completion gate and completeness critic:

```bash
# Run completion gate
bun $PINNED run:exec --run $RUN --gate gate-run-completion --actor coordinator -- bun test tests

# Initialize completeness critic session
bun $PINNED critic:start --run $RUN --critic <critic-id>

# Critic approves all requirements and gate evidence
bun $PINNED critic:review --run $RUN --critic <critic-id> --token <token> --decision approve --summary "<summary>"

# Complete the run and seal artifacts
bun $PINNED run:complete --run $RUN --actor coordinator
bun $PINNED run:status --run $RUN
```

### Phase 5: Visual Reporting & Summary Suite

Export graph summary and visual dashboard:

```bash
# Export summary suite (graph dataset, metrics, timeline)
bun $PINNED summary:export --run $RUN

# View human-readable summary
bun $PINNED summary:view --run $RUN
```

---

## Harness Configuration (`harness.config.json`)

Harness behavior can be customized by placing a `harness.config.json` or `.harness.config.json` file in the repository root (or per-capsule `config.json`):

```json
{
  "max_repair_rounds": 5,
  "max_output_bytes": 10485760,
  "default_lease_seconds": 1800,
  "default_max_parallel": 4,
  "strict_validation": true
}
```

- **`max_repair_rounds`** (default `5`): Maximum repair rounds allowed for a rejected task or completeness critic remediation before transitioning to `escalated`.
- **`max_output_bytes`** (default `10MB`): Maximum stdout/stderr output size captured per command execution.
- **`default_lease_seconds`** (default `1800`): Default worker lease duration for task claims.
- **`default_max_parallel`** (default `4`): Default concurrency limit for independent task execution.
- **`strict_validation`** (default `true`): Enforces mandatory gate coverage and independent validator checks.
