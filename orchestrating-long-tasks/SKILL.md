---
name: orchestrating-long-tasks
description: Use when a request is long-running, spans multiple files or subsystems, needs parallel agents, must survive restarts or context loss, or requires independent validation and bounded repair before completion.
---

# Orchestrating Long Tasks

Turn a large prompt into a durable, graph-scheduled, independently validated run. Authoritative
coordination lives under `.capsules/<run>/`, so any supported host — Claude Code, Antigravity, Codex
or ChatGPT coding agents — can resume the run without conversation history.

**This file is an index, not a manual.** It binds every agent, then routes you to the document your current job needs.

## Primary entry point: `orchestrate`

Reach for `orchestrate` before assembling this sequence by hand: everything after the command name
is the prompt, byte for byte, no flags to learn — bare piped stdin is read automatically too
(`--prompt-stdin`/`--prompt-file` still work for `--repo`/`--run`). It opens the capsule and hands back
one fixed step: register and dispatch a Tier 1 orchestrator; everything after is its job. Stand down host todo tools.

## Why the harness exists

- **Observability over every step.** Every action is a recorded command with an actor, exit code, and evidence class.
- **Quality through gating.** Work is independently validated, adversarially probed, and held to real command evidence.
- **Attention on the problem.** The CLI absorbs bookkeeping — leases, waves, findings, lineage — for maximum focus.
- **Commands, not conversation.** Agents call harness commands the way code calls an API — deterministic and replayable.
- **The harness never thinks.** It orchestrates and records; reasoning happens host-side with every host tool allowed.
- **No agent needs the whole skill.** Only the slice its current job requires, via the routing tables below.

## When to use

Use when the prompt carries many instructions, files, phases or criteria; when lanes run concurrently;
when work needs adversarial review, repair loops or mandatory gates; or when stale workers need recovery.
Do not create a harness for a simple answer, one-file mechanical edit, or short single-agent diagnostic.

## Hard rules

1. Preserve the user's complete prompt as immutable bytes before summarizing or planning it.
2. Never treat agent prose as authoritative state or proof.
3. Never let an implementer validate its own work or feed its report into a validator packet (Triad Floor in [`references/protocol.md`](references/protocol.md)).
4. Never dispatch overlapping write scopes in parallel. Never mutate a run without the authenticated harness CLI.
5. Never call a model API or launch an LLM CLI. The Coordinator MUST dispatch Tier 3 implementers and validators via host native subagents (Antigravity: `invoke_subagent`, Claude Code: `Agent`, Codex: `spawn_agent`, Cursor: `Task`) using parallel batch arrays (`Subagents: [...]`) and is STRICTLY FORBIDDEN from editing code, running test loops, or implementing tasks directly on the main thread.
6. Never announce completion while the runtime reports a blocker. Never invent values (absent is "unknown").
7. Describe mandatory gate evidence only as `trusted_host_observed_v1`. Scope task `--gate` to touched files.
8. Enforce 4-Tier Viewport Resolution Matrix for UI tasks: Desktop-Wide (1920x1080), Desktop (1440x900), Tablet (768x1024), Mobile (390x844). Omitting desktop-wide resolution is a mandatory rejection.
9. Require quantitative proofs over superficial prose: exit codes, DOM metrics, APCA Lc, screenshots (>=1024B) under `--require-semantic-depth`.
10. Maintain continuous non-stop loops: auto-chain phases without human intervention; use host timers/schedules (`schedule`) and `pulse.sh` floor loops (`|| true`).
11. Repository root `.capsules/` invariant and Zero `/tmp` Ban: capsules MUST ALWAYS live at the active Git repo root (`<repo-root>/.capsules/`). All skills work, artifacts, reports, and payloads must reside exclusively in `.capsules/` (never `/tmp` or `.tmp/`). Keeping temporary files, scratch artifacts, or run states under `/tmp` or `.tmp/` is strictly prohibited.
12. Throttle CPU gates to `gate_max_parallel`; reasoners scale to `default_max_parallel` ([`references/configuration.md`](references/configuration.md)).
13. Scratch workspace isolation: use native host workspace isolation (`Workspace: "branch"` or `"share"`) or git worktrees for disk-mutating concurrent runs.
14. Consolidation of user pushbacks and self-audits: consolidate all user pushbacks and model self-critiques into canonical documentation.
15. Strict TypeScript and linter hygiene: zero `any` annotations, casts, or generic defaults, zero compiler/linter suppressions.
16. Mandatory 3-Minute Supervisory Scheduler & Algorithmic DAG Optimization: Every long task, multi-phase execution, or autonomous mind loop MUST enforce a recurring 3-minute supervisory scheduler (`schedule` cron `*/3 * * * *`, systemd timer, or floor loop) and provide live ASCII DAG introspection (`dag:view`) with algorithmic parallelization recommendations to eliminate serial bottlenecks without main-thread or coordinator direct code editing.
17. Infinite Mind Cadence, No Agent-Driven Termination & Background Finalization Isolation: Mind systems and multi-phase orchestrations MUST execute as infinite, non-stop cadence loops unless explicitly halted by the human user. Subagents and coordinators are STRICTLY FORBIDDEN from killing schedulers or terminating pulses. Finalization (git commits, pushes, release sealing, global skill syncing) MUST be executed by the dedicated Tier 1 Background Orchestrator / Tier 0 Mind Runner on its own background thread, NEVER spilled onto the main interactive thread.
18. Main-Thread Containment Invariant & Thread Authority (`whoami`): The main interactive thread orchestrates top-level flow and dispatches Tier 2 Background Coordinators and Tier 3 subagents via host-native mechanisms (Antigravity: `invoke_subagent`, Claude Code: `Agent`, Codex: `spawn_agent`, Cursor: `Task`). The main thread MUST NEVER directly implement code, run test loops, or ingest/read massive JSON dumps (such as raw `state.json`). Harness command `whoami` (superseding legacy alias thread:identify) inspects thread and process authority to verify execution context; if an agent or thread detects it is operating on the main interactive thread, it must immediately transition execution to background subagents and return to the skill flow.
19. True Visual Directed Acyclic Graph (DAG) Formatting: Graph introspection (`dag:view`) and supervisory status reports must render true topological DAG representations in ASCII/Unicode boxed format (with boxes, arrows, levels, and active node indicators like `[● ACTIVE]`, `[✓ DONE]`, `[○ READY]`), rather than flat prose, bulleted lists, or vague status words.

## Route by role

Every agent holds exactly one role; `roles/<role>.md` is its binding contract. Load your contract, persona, and reference.

| Role (tier)               | Contract + persona                                                                                                                                                           | Read for the job                                                                               | Never read                                                                  |
| :------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------- |
| `mind` (0)                | [roles/mind.md](roles/mind.md) + [agents/mind.yaml](agents/mind.yaml)                                                                                                        | [host-adapters.md](references/host-adapters.md), [protocol.md](references/protocol.md)         | Execution details; it observes, admits, and deploys tier 1 orchestrators    |
| `orchestrator` (1)        | [roles/orchestrator.md](roles/orchestrator.md) + [agents/orchestrator.yaml](agents/orchestrator.yaml)                                                                        | [host-adapters.md](references/host-adapters.md), [protocol.md](references/protocol.md)         | Any task-level phase; it never claims, implements or replans directly       |
| `mind-auditor` (1)        | [roles/mind-auditor.md](roles/mind-auditor.md) + [agents/mind-auditor.yaml](agents/mind-auditor.yaml)                                                                        | [protocol.md](references/protocol.md), ledger and capsule integrity                            | Mind self-assessment narrative; it audits strictly from verifiable evidence |
| `coordinator` (2)         | [roles/coordinator.md](roles/coordinator.md) + [agents/coordinator.yaml](agents/coordinator.yaml)                                                                            | [run-playbook.md](references/run-playbook.md), [host-adapters.md](references/host-adapters.md) | Validator and critic protocols; it may not judge or write code              |
| `planner` (3)             | [roles/planner.md](roles/planner.md) + [agents/planner.yaml](agents/planner.yaml)                                                                                            | [schema-examples.md](references/schema-examples.md), playbook Phase 1                          | Anything about validation, branches or sealing                              |
| `plan-validator` (3)      | [roles/plan-validator.md](roles/plan-validator.md) + [agents/plan-validator.yaml](agents/plan-validator.yaml)                                                                | Playbook Phase 1; reviews the compiled graph before any implementer dispatches                 | Implementer reports, task-level findings — it judges the plan, not the code |
| `implementer` (3)         | [roles/implementer.md](roles/implementer.md) + [agents/implementer.yaml](agents/implementer.yaml) + [agents/worker.yaml](agents/worker.yaml)                                 | Playbook Phases 3–4                                                                            | `agents/validator.yaml`, `agents/critic.yaml`, the critic protocol          |
| `repairer` (3)            | [roles/repairer.md](roles/repairer.md) + [agents/repairer.yaml](agents/repairer.yaml) + [agents/worker.yaml](agents/worker.yaml)                                             | The open findings (`finding:get`), then playbook Phase 3                                       | Validator persona; a repairer never grades its own repair                   |
| `validator` (3)           | [roles/validator.md](roles/validator.md) + [agents/validator.yaml](agents/validator.yaml)                                                                                    | Playbook Phase 5; the persona carries the dual-channel UI mandate                              | Implementer prose and prior reviews — the packet strips them                |
| `mechanic-validator` (3)  | [roles/mechanic-validator.md](roles/mechanic-validator.md) + [agents/mechanic_validator.yaml](agents/mechanic_validator.yaml)                                                 | Playbook Phase 5; executes deterministic scripts, unit tests & AGP                             | Implementer prose and prior reviews — the packet strips them                |
| `completeness-critic` (3) | [roles/completeness-critic.md](roles/completeness-critic.md) + [agents/completeness-critic.yaml](agents/completeness-critic.yaml) + [agents/critic.yaml](agents/critic.yaml) | Playbook Phase 6, [schema-examples.md](references/schema-examples.md)                          | Implementer reports; the critic judges the diff, not the story              |
| `sub-implementer` (3)     | [roles/sub-implementer.md](roles/sub-implementer.md) + [agents/sub-implementer.yaml](agents/sub-implementer.yaml)                                                            | Playbook Phase 4 only                                                                          | The parent task's plan, review and gate documents                           |
| `sub-validator` (3)       | [roles/sub-validator.md](roles/sub-validator.md) + [agents/sub-validator.yaml](agents/sub-validator.yaml)                                                                    | Playbook Phase 4 only                                                                          | Verdict commands — it gathers evidence and issues no verdict                |
| `sub-investigator` (3)    | [roles/sub-investigator.md](roles/sub-investigator.md) + [agents/sub-investigator.yaml](agents/sub-investigator.yaml)                                                        | Playbook Phase 4 only                                                                          | Anything that mutates; it reproduces, bisects and reports                   |

Host adapters: [agents/antigravity.yaml](agents/antigravity.yaml), [agents/claude.yaml](agents/claude.yaml), [agents/codex.yaml](agents/codex.yaml), [agents/cursor.yaml](agents/cursor.yaml), [agents/generic.yaml](agents/generic.yaml), [agents/openai.yaml](agents/openai.yaml). Validator domain contracts:
[roles/validator-code-quality.md](roles/validator-code-quality.md), [roles/validator-product.md](roles/validator-product.md), [roles/validator-security.md](roles/validator-security.md), [roles/validator-system-design.md](roles/validator-system-design.md), [roles/validator-ui-design.md](roles/validator-ui-design.md) (B12).

## Route by phase & references

Command sequences: [`references/run-playbook.md`](references/run-playbook.md); rules: [`references/protocol.md`](references/protocol.md).

- **Plan**: `plan:init`, `plan:enhance`, `plan:add` (use `--auto-partition <glob>`, [`references/topology-exemplar.md`](references/topology-exemplar.md)), `plan:compile`, `dag:view`, [`references/schema-examples.md`](references/schema-examples.md).
- **Dispatch**: `queue:wave`, `agent:register`, [`references/host-adapters.md`](references/host-adapters.md) (main-thread isolation, per-host dispatch).
- **Execute**: `task:claim`, `run:exec`, `task:submit`, `task:release`, [`references/parity-matrix.md`](references/parity-matrix.md).
- **Branch**: `branch:open`, `branch:claim`, `branch:submit`, `branch:collect`, [`references/state-model.md`](references/state-model.md).
- **Validate**: `task:validate-start`, `task:probe`, `task:reject`, `task:review`, [`references/failure-modes.md`](references/failure-modes.md).
- **Replan & Seal**: `critic:reject`, `plan:replan`, `critic:start`, `critic:review`, `run:complete`.
- **Recover & Inspect**: `recover`, `doctor`, `summary:export`, `summary:view`, `dag:view`, `whoami`, [`references/cli.md`](references/cli.md), [`references/cli-capabilities.md`](references/cli-capabilities.md) ([`references/cli-capabilities.json`](references/cli-capabilities.json)).

## Critical Anti-Patterns & Operational Guardrails

- **Main-Thread Fallback & Context Flooding**: Never edit files, run test loops, or ingest massive JSON payloads (such as raw `state.json`) on the main interactive thread. Main thread only orchestrates and dispatches parallel Tier 2 Coordinators and Tier 3 subagents via host-native subagents (Antigravity: `invoke_subagent`, Claude Code: `Agent`, Codex: `spawn_agent`, Cursor: `Task`). Enforce thread boundaries via `whoami`.
- **Temporary Directory Leakage (Zero /tmp Ban)**: Never store state, artifacts, scratch files, or reports under `/tmp` or `.tmp/`. All skills work, artifacts, reports, and payloads must reside exclusively in `<repo-root>/.capsules/`.
- **Missing Supervisory Schedule / 3-Minute Watchdog**: Never leave background tasks unmonitored or terminate schedulers on idle ticks. Always register a recurring 3-minute supervisory cron/timer (`schedule` cron `*/3 * * * *`, systemd timer, or floor loop).
- **Prose-Only or List-Only DAG Reports**: Never represent graph status as flat text lists or generic status adjectives ("satisfied", "done"). Always render True Visual DAGs in ASCII/Unicode boxed format with topological levels and active node indicators (`dag:view`).
- **Sequential Execution Simulation**: Never serialize disjoint tasks when parallel wave subagents can be dispatched. Inspect and optimize the DAG via `dag:view`.
- **Coordinator Code Pollution**: Never let coordinators or supervisors write code directly.
- **Viewport Omission**: Never test single viewport. Visual UI tasks require all 4: Desktop-Wide (1920x1080), Desktop (1440x900), Tablet (768x1024), Mobile (390x844).
- **Superficial Audits**: Never pass on qualitative praise. Reviews require quantitative metrics, APCA Lc, and screenshots (>=1024B).
- **Scheduler Halts**: Never stop between phases. Maintain continuous autonomous pulses via schedules/crons and floor loops.
- **Nested Capsules**: Never nest `.capsules/` in subdirectories; always anchor to local repo root `<repo-root>/.capsules/`.

## Before writing any command

Check flags in [`references/cli-capabilities.json`](references/cli-capabilities.json) or ask the harness live:

```bash
bun orchestrating-long-tasks/scripts/harness.ts help <command>
```

Explain errors: `explain --code <CODE>` (or `--command <name>`).
