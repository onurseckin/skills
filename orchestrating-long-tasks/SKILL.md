---
name: orchestrating-long-tasks
description: Use when a request is long-running, spans multiple files or subsystems, needs parallel agents, must survive restarts or context loss, or requires independent validation and bounded repair before completion.
---

# Orchestrating Long Tasks

Turn a large prompt into a durable, graph-scheduled, independently validated run. The harness keeps
authoritative coordination under `.capsules/<run>/`, stores lightweight, verifiable state artifacts,
and can be resumed by Codex, ChatGPT coding agents, Claude Code, or Antigravity without relying
on conversation history or model-provider APIs.

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
bun $PINNED task:reject --run $RUN --task <task-id> --validator <val-agent> --token <token> --reason "<reason>" --finding "<remediation>"
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

## Two-Tier Agent Architecture & Main Thread Isolation

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

