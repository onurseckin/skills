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
11. Repository root `.capsules/` invariant and Zero `/tmp` Ban: capsules MUST ALWAYS live at the active Git repo root (`<repo-root>/.capsules/`). Mind queue storage canonically lives under `<repo-root>/.capsules/mind/queue/` (with `.capsules/todo/` alias) housing standardized lowercase kebab-case files (`feedback-queue.jsonl`, `completed-tasks.jsonl`, `blunders.jsonl`, `completed-blunders.jsonl`, `observations.jsonl`, `watchdogs.json`), alongside indexed cognitive memory (`.capsules/mind/memory.json`). All skills work, artifacts, reports, and payloads must reside exclusively in `.capsules/` (never `/tmp` or `.tmp/`). Keeping temporary files, scratch artifacts, or run states under `/tmp` or `.tmp/` is strictly prohibited.
12. Throttle CPU gates to `gate_max_parallel`; reasoners scale to `default_max_parallel` ([`references/configuration.md`](references/configuration.md)).
13. Scratch workspace isolation: use native host workspace isolation (`Workspace: "branch"` or `"share"`) or git worktrees for disk-mutating concurrent runs.
14. Consolidation of user pushbacks and self-audits: consolidate all user pushbacks and model self-critiques into canonical documentation.
15. Strict TypeScript and linter hygiene: zero `any` annotations, casts, or generic defaults, zero compiler/linter suppressions.
16. Mandatory 3-Minute Supervisory Scheduler & Algorithmic DAG Optimization: Every long task, multi-phase execution, or autonomous mind loop MUST enforce a recurring 3-minute supervisory scheduler (`schedule` cron `*/3 * * * *`, systemd timer, or floor loop) and provide live ASCII DAG introspection (`dag:view`) with algorithmic parallelization recommendations to eliminate serial bottlenecks without main-thread or coordinator direct code editing.
17. Infinite Mind Cadence, No Agent-Driven Termination & Background Finalization Isolation: Mind systems and multi-phase orchestrations MUST execute as infinite, non-stop cadence loops unless explicitly halted by the human user. Subagents and coordinators are STRICTLY FORBIDDEN from killing schedulers or terminating pulses. Finalization (git commits, pushes, release sealing, global skill syncing) MUST be executed by the dedicated Tier 1 Background Orchestrator / Tier 0 Mind Runner on its own background thread, NEVER spilled onto the main interactive thread.
18. Main-Thread Containment Invariant & Thread Authority (`whoami`): The main interactive thread orchestrates top-level flow and dispatches Tier 2 Background Coordinators and Tier 3 subagents via host-native mechanisms (Antigravity: `invoke_subagent`, Claude Code: `Agent`, Codex: `spawn_agent`, Cursor: `Task`). The main thread MUST NEVER directly implement code, run test loops, or ingest/read massive JSON dumps (such as raw `state.json`). Harness command `whoami` (superseding legacy alias thread:identify) inspects thread and process authority to verify execution context; if an agent or thread detects it is operating on the main interactive thread, it must immediately transition execution to background subagents and return to the skill flow.
19. True Visual Directed Acyclic Graph (DAG) Formatting: Graph introspection (`dag:view`) and supervisory status reports must render true topological DAG representations in ASCII/Unicode boxed format (with boxes, arrows, levels, and active node indicators like `[● ACTIVE]`, `[✓ DONE]`, `[○ READY]`), rather than flat prose, bulleted lists, or vague status words.
20. Zero-Exploration 1-Shot Subagent Briefings: Every deployed subagent MUST receive an instant, all-inclusive 1-shot briefing in its dispatch prompt containing: assigned task ID & title, exact disjoint write scope, suggested target files, allowed and recommended test commands (`bun test <path.test.ts>` for implementers), acceptance criteria, and next steps (`task:brief`, `agent:brief`). Coordinators must NEVER assign unit test commands to validators (Implementers own 100% of unit test execution; Cognitive Validators execute 0 commands; Mechanic Validators execute ONLY typecheck `tsc --noEmit`, AST static audits, and AGPs).
21. 1-Hop Implementer <-> Validator Micro-Cycles: Paired validators provide fast in-lease structured critique (`--micro-cycle` / `--in-lease`) without lease teardown; implementers address feedback in-lease, verify with file-scoped tests (`bun test <path.test.ts>`), and re-submit up to 3 micro-cycle rounds before formal escalation.
22. Per-Task/Subgroup Commit, Push & Global Skill Sync: Upon task or subgroup verification and completion, coordinators and orchestrators MUST create a Conventional Commit (`feat(...)`, `fix(...)`), push to `origin/main` (`git push origin main`), and sync global skills via `bun scripts/sync-global.ts` to `~/.agents/skills/orchestrating-long-tasks/`.
23. Hard Agent Reset Discipline: Upon wave completion or task group finish, coordinators and orchestrators MUST execute a hard reset on completed subagents (`manage_subagents` with `Action: 'kill'`) to prevent stale context accumulation and ghost leases.
24. Strict Test Execution Ban on Coordinator & Orchestrator: Coordinators and orchestrators are STRICTLY FORBIDDEN from running repo-wide or task test suites directly (`bun test`, `npm test`, `vitest`); all test execution is strictly delegated to Tier 3 Mechanic Validators using file-scoped test commands.
25. Strict Non-Idle Autonomous Task Discovery Invariant: When the feedback queue is empty (0 pending items), Tier 0 Mind is strictly forbidden from sitting idle, entering standby, or terminating pulse cadence. Mind MUST automatically trigger Autonomous Discovery Mode (0 any checks, charter gap audits, blunder regression tests, Work/Span P = W / S optimizations).
26. Gen5 Dynamic Wave Decoupling & Topological Parallel Cognition: Tasks with disjoint write scopes are dynamically decoupled into independent topological waves (`detectScopeOverlap`) without artificial linear chaining. Task planners and feedback synthesizers must maximize Brent Work/Span concurrency ($P = \lceil W / S \rceil$) across parallel lanes.
27. Multi-Attribute Semantic Memory & Cross-Generational Search: Cross-generational cognitive querying (`memory:query` / `memory:search`) supports fine-grained multi-attribute filtering across `--kind` (task, capture, decision, blunder, blunder_promotion, objective, artifact), `--generation` (`--gen`), `--tags`, `--pattern` (regex matching), and semantic query terms (`--query`), ensuring deep memory grounding and historical blunder avoidance.
28. Automated Blunder Promotion & Permanent Regression Immunity: Resolved blunders in `blunders.jsonl` are automatically audited and promoted (`blunder:audit --auto-promote`) into `completed-blunders.jsonl` with empirical proof and regression test assertions (`--generate-tests`, `--output-tests`), maintaining 100% regression immunity across all historical blunder instances (46 verified blunder remediations).
29. Infinite Mind Product Owner Mode & Atomic Admission-to-Dispatch Chaining: Tier 0 Mind operates as an Infinite Product Owner governing backlog lifecycle (Mode A: Autonomous Self-Evolution on empty queue vs Mode B: External Intake). Admitting feedback atomically chains into task queue dispatch with ZERO paused admitted items (`reconcilePausedAdmittedFeedbacks`), 1:1 single-implementer and single-validator isolated task dispatch (Anti-Batching Rule), and concurrent multi-orchestrator pre-planning.
30. Active 4-Tier Hierarchical Parent-Child Supervision: Execution strictly respects top-down 4-tier supervision (Tier 0 Mind -> Tier 1 Orchestrator -> Tier 2 Coordinator -> Tier 3 Workers). Bypassing tiers (e.g. Mind spawning Coordinators/Implementers or Orchestrator spawning Implementers directly) is strictly prohibited and mechanically blocked.
31. Cognitive Validator Hard-Lock Interlock: Cognitive Validators (domains: `code-quality`, `product`, `security`, `system-design`, `ui-design`, and general `validator`) are hard-locked from command execution (0 `run:exec`, 0 tests, 0 terminal commands, 0 build tools), dedicating 100% bandwidth to code reading and Socratic critique. Mechanic Validators (`mechanic-validator`) retain test execution and shell authority. Implementers own 100% of unit test execution.
32. Script-Backed Scheduler Diagnostics Engine: Scheduler pulses and coordination loops MUST execute deterministic script-backed diagnostic inspectors (`doctor`, `health`, `dag:view`, `report:unified`) before generating telemetry, embedding live CLI receipts with SHA-256 cryptographic hashes and ASCII DAG badges into pulse briefs.

## Route by role

Every agent holds exactly one role; `roles/<role>.md` is its binding contract. Load your contract, persona, and reference.

| Role (tier)               | Contract + persona                                                                                                                                                                                     | Read for the job                                                                               | Never read                                                                                                                          |
| :------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| `mind` (0)                | [roles/mind.md](roles/mind.md) + [agents/mind.yaml](agents/mind.yaml)                                                                                                                                  | [host-adapters.md](references/host-adapters.md), [protocol.md](references/protocol.md)         | Execution details; it observes, admits, governs queue in `.capsules/mind/queue/`, persists memory, and deploys tier 1 orchestrators |
| `orchestrator` (1)        | [roles/orchestrator.md](roles/orchestrator.md) + [agents/orchestrator.yaml](agents/orchestrator.yaml)                                                                                                  | [host-adapters.md](references/host-adapters.md), [protocol.md](references/protocol.md)         | Any task-level phase; it never claims, implements or replans directly                                                               |
| `mind-auditor` (1)        | [roles/mind-auditor.md](roles/mind-auditor.md) + [agents/mind-auditor.yaml](agents/mind-auditor.yaml)                                                                                                  | [protocol.md](references/protocol.md), ledger and capsule integrity                            | Mind self-assessment narrative; it audits strictly from verifiable evidence                                                         |
| `coordinator` (2)         | [roles/coordinator.md](roles/coordinator.md) + [agents/coordinator.yaml](agents/coordinator.yaml)                                                                                                      | [run-playbook.md](references/run-playbook.md), [host-adapters.md](references/host-adapters.md) | Validator and critic protocols; it may not judge or write code                                                                      |
| `planner` (3)             | [roles/planner.md](roles/planner.md) + [agents/planner.yaml](agents/planner.yaml)                                                                                                                      | [schema-examples.md](references/schema-examples.md), playbook Phase 1                          | Anything about validation, branches or sealing                                                                                      |
| `plan-validator` (3)      | [roles/plan-validator.md](roles/plan-validator.md) + [agents/plan-validator.yaml](agents/plan-validator.yaml)                                                                                          | Playbook Phase 1; reviews the compiled graph before any implementer dispatches                 | Implementer reports, task-level findings — it judges the plan, not the code                                                         |
| `implementer` (3)         | [roles/implementer.md](roles/implementer.md) + [agents/implementer.yaml](agents/implementer.yaml) + [agents/worker.yaml](agents/worker.yaml)                                                           | Playbook Phases 3–4                                                                            | `agents/validator.yaml`, `agents/critic.yaml`, the critic protocol                                                                  |
| `repairer` (3)            | [roles/repairer.md](roles/repairer.md) + [agents/repairer.yaml](agents/repairer.yaml) + [agents/worker.yaml](agents/worker.yaml)                                                                       | The open findings (`finding:get`), then playbook Phase 3                                       | Validator persona; a repairer never grades its own repair                                                                           |
| `validator` (3)           | [roles/validator.md](roles/validator.md) + [agents/validator.yaml](agents/validator.yaml) + [agents/ui-validator.yaml](agents/ui-validator.yaml)                                                       | Playbook Phase 5; cognitive code reading & Socratic critique (0 commands)                      | Implementer prose and prior reviews — the packet strips them                                                                        |
| `mechanic-validator` (3)  | [roles/mechanic-validator.md](roles/mechanic-validator.md) + [agents/mechanic_validator.yaml](agents/mechanic_validator.yaml) + [agents/ui-mechanic-validator.yaml](agents/ui-mechanic-validator.yaml) | Playbook Phase 5; typechecks (`tsc --noEmit`), AST static scans & AGP (no unit tests)          | Implementer prose and prior reviews — the packet strips them                                                                        |
| `completeness-critic` (3) | [roles/completeness-critic.md](roles/completeness-critic.md) + [agents/completeness-critic.yaml](agents/completeness-critic.yaml) + [agents/critic.yaml](agents/critic.yaml)                           | Playbook Phase 6, [schema-examples.md](references/schema-examples.md)                          | Implementer reports; the critic judges the diff, not the story                                                                      |
| `sub-implementer` (3)     | [roles/sub-implementer.md](roles/sub-implementer.md) + [agents/sub-implementer.yaml](agents/sub-implementer.yaml)                                                                                      | Playbook Phase 4 only                                                                          | The parent task's plan, review and gate documents                                                                                   |
| `sub-validator` (3)       | [roles/sub-validator.md](roles/sub-validator.md) + [agents/sub-validator.yaml](agents/sub-validator.yaml)                                                                                              | Playbook Phase 4 only                                                                          | Verdict commands — it gathers evidence and issues no verdict                                                                        |
| `sub-investigator` (3)    | [roles/sub-investigator.md](roles/sub-investigator.md) + [agents/sub-investigator.yaml](agents/sub-investigator.yaml)                                                                                  | Playbook Phase 4 only                                                                          | Anything that mutates; it reproduces, bisects and reports                                                                           |

Host adapters: [agents/antigravity.yaml](agents/antigravity.yaml), [agents/claude.yaml](agents/claude.yaml), [agents/codex.yaml](agents/codex.yaml), [agents/cursor.yaml](agents/cursor.yaml), [agents/generic.yaml](agents/generic.yaml), [agents/openai.yaml](agents/openai.yaml). Validator domain contracts:
[roles/validator-code-quality.md](roles/validator-code-quality.md), [roles/validator-product.md](roles/validator-product.md), [roles/validator-security.md](roles/validator-security.md), [roles/validator-system-design.md](roles/validator-system-design.md), [roles/validator-ui-design.md](roles/validator-ui-design.md) (B12).

## Route by phase & references

Command sequences: [`references/run-playbook.md`](references/run-playbook.md); rules: [`references/protocol.md`](references/protocol.md).

- **Mind Queue & Feedback**: `mind:queue:list` (alias `todo:list`), `mind:queue:add` (`todo:add`), `mind:queue:drain` (`todo:drain`), `mind:queue:seal` (`todo:seal`), `mind:queue:clean` (`todo:clean`), `memory:query`, `memory:search`, `blunder:audit` (with `--auto-promote`, `--generate-tests`), `smart-task:plan`, `smart-task:ingest`.
- **Plan**: `plan:init`, `plan:enhance`, `plan:add` (use `--auto-partition <glob>`, [`references/topology-exemplar.md`](references/topology-exemplar.md)), `plan:compile`, `dag:view`, [`references/schema-examples.md`](references/schema-examples.md).
- **Dispatch**: `queue:wave`, `agent:register`, `task:brief`, `agent:brief`, [`references/host-adapters.md`](references/host-adapters.md) (main-thread isolation, per-host dispatch).
- **Execute**: `task:claim`, `run:exec`, `task:submit`, `task:release`, [`references/parity-matrix.md`](references/parity-matrix.md).
- **Branch**: `branch:open`, `branch:claim`, `branch:submit`, `branch:collect`, [`references/state-model.md`](references/state-model.md).
- **Validate**: `task:validate-start`, `task:probe`, `task:reject` (with `--micro-cycle`), `task:review`, [`references/failure-modes.md`](references/failure-modes.md).
- **Replan & Seal**: `critic:reject`, `plan:replan`, `critic:start`, `critic:review`, `run:complete`.
- **Recover & Inspect**: `recover`, `doctor`, `summary:export`, `summary:view`, `dag:view`, `whoami`, `memory:query`, `blunder:audit`, [`references/cli.md`](references/cli.md), [`references/cli-capabilities.md`](references/cli-capabilities.md) ([`references/cli-capabilities.json`](references/cli-capabilities.json)).

## Critical Anti-Patterns & Operational Guardrails

- **Main-Thread Fallback & Context Flooding**: Never edit files, run test loops, or ingest massive JSON payloads (such as raw `state.json`) on the main interactive thread. Main thread only orchestrates and dispatches parallel Tier 2 Coordinators and Tier 3 subagents via host-native subagents (Antigravity: `invoke_subagent`, Claude Code: `Agent`, Codex: `spawn_agent`, Cursor: `Task`). Enforce thread boundaries via `whoami`.
- **Un-Briefed Subagent Spawning**: Never spawn subagents without complete 1-shot briefings (`task:brief`, `agent:brief`). Subagents must receive all necessary context, write scopes, and test commands in their initial prompt to eliminate exploratory probing.
- **Direct Test Suite Execution by Coordinator / Orchestrator**: Never run raw test suites (`bun test`, `vitest`, `npm test`) from coordinator or orchestrator threads. Test execution belongs exclusively to Tier 3 Mechanic Validators.
- **Ghost Subagent Accumulation**: Never leave finished subagents un-killed; always enforce hard agent reset discipline (`manage_subagents` with `Action: 'kill'`) upon wave or subgroup completion.
- **Uncommitted Verified Tasks**: Never leave verified task groups uncommitted or un-synced; always create Conventional Commits, push to `origin/main`, and run `bun scripts/sync-global.ts`.
- **Temporary Directory Leakage (Zero /tmp Ban)**: Never store state, artifacts, scratch files, or reports under `/tmp` or `.tmp/`. All skills work, artifacts, reports, and payloads must reside exclusively in `<repo-root>/.capsules/`.
- **Mind Idle / Standby Anti-Pattern**: Never permit Tier 0 Mind to sit idle or emit "waiting in standby" when the feedback queue is empty. Autonomous discovery (0 any checks, charter gap audits, blunder regression tests, Work/Span P = W / S optimizations) must trigger automatically.
- **Artificial Serialization Anti-Pattern**: Never chain tasks with disjoint write scopes sequentially when dynamic wave decoupling (`detectScopeOverlap`) can schedule them in parallel. Always inspect and optimize DAG waves via `dag:view`.
- **Unevidenced Blunder Dismissal Anti-Pattern**: Never resolve or ignore blunders without empirical proof (`commit_sha`, `test_assertion`, `task_id`) and automated promotion (`blunder:audit --auto-promote`).
- **Missing Supervisory Schedule / 3-Minute Watchdog**: Never leave background tasks unmonitored or terminate schedulers on idle ticks. Always register a recurring 3-minute supervisory cron/timer (`schedule` cron `*/3 * * * *`, systemd timer, or floor loop).
- **Prose-Only or List-Only DAG Reports**: Never represent graph status as flat text lists or generic status adjectives ("satisfied", "done"). Always render True Visual DAGs in ASCII/Unicode boxed format with topological levels and active node indicators (`dag:view`).
- **Sequential Execution Simulation**: Never serialize disjoint tasks when parallel wave subagents can be dispatched. Inspect and optimize the DAG via `dag:view`.
- **Coordinator Code Pollution**: Never let coordinators or supervisors write code directly.
- **Viewport Omission**: Never test single viewport. Visual UI tasks require all 4: Desktop-Wide (1920x1080), Desktop (1440x900), Tablet (768x1024), Mobile (390x844).
- **Paused Admitted Feedback Items & Non-Atomic Intake**: Never permit admitted feedback items to linger in a paused admitted intermediate state. Every admission must atomically chain into a task queue dispatch (`FEEDBACK_QUEUE.jsonl` -> `TASK_QUEUE.jsonl`).
- **Hierarchical Tier-Bypassing & Cross-Tier Spawning**: Never bypass intermediate supervisory tiers (e.g. Mind spawning Implementers directly, or Orchestrator spawning Implementers without a Coordinator). All dispatches must respect top-down 4-tier parental supervision.
- **Cognitive Validator Command Execution Leak**: Never assign or permit terminal, shell, or unit test execution to Cognitive Validators. Cognitive Validators are hard-locked from command execution (0 `run:exec`); all command execution belongs exclusively to Mechanic Validators.
- **Unverified Telemetry & Prose-Only Status Reports**: Never emit scheduler status without script-backed diagnostic receipts (`doctor`, `health`, `dag:view`, `report:unified`), cryptographic SHA-256 hashes, and ASCII DAG badges.
- **Nested Capsules**: Never nest `.capsules/` in subdirectories; always anchor to local repo root `<repo-root>/.capsules/`.

## Before writing any command

Check flags in [`references/cli-capabilities.json`](references/cli-capabilities.json) or ask the harness live:

```bash
bun orchestrating-long-tasks/scripts/harness.ts help <command>
```

Explain errors: `explain --code <CODE>` (or `--command <name>`).
