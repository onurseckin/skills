---
name: orchestrating-long-tasks
description: Use when a request is long-running, spans multiple files or subsystems, needs parallel agents, must survive restarts or context loss, or requires independent validation and bounded repair before completion.
---

# Orchestrating Long Tasks

Turn a large prompt into a durable, graph-scheduled, independently validated run. Authoritative
coordination lives under `.capsules/<run>/`, so any supported host — Claude Code, Antigravity, Codex
or ChatGPT coding agents — can resume the run without conversation history.

**This file is an index, not a manual.** It carries the rules that bind every agent, then routes you
to the one document your current job needs. Read your row; skip the rest. Nothing here summarises a
document that exists — a summary is a second copy with a shorter half-life.

## Primary entry point: `orchestrate`

Reach for `orchestrate` before assembling this sequence by hand: everything after the command name
is the prompt, byte for byte, no flags to learn — a bare piped stdin is read automatically too
(`--prompt-stdin`/`--prompt-file` still work for a caller that also needs `--repo`/`--run`). It opens
the capsule and hands back the fixed checklist for what's next — enhance, stage, compile, dispatch.
When this skill is driving, it owns the orchestration: stand down the host's own todo/workflow tool.

## Why the harness exists

- **Observability over every step.** Every action is a recorded command with an actor, an exit code and an evidence class, so a run is auditable instead of merely remembered.
- **Quality through gating.** Work is independently validated, adversarially probed, and held to real command evidence before it can be called done.
- **Attention on the problem.** The CLI absorbs the bookkeeping — leases, waves, findings, lineage — so the model spends its context on the actual decisions.
- **Commands, not conversation.** Agents call harness commands the way code calls an API — deterministic, recorded, replayable.
- **The harness never thinks.** It orchestrates and records — never a model call, never an LLM CLI —
  and reasoning happens host-side, under the user's own subscription, with every host tool allowed.
- **No agent needs the whole skill.** Only the slice its current job requires, which is what the
  routing tables below are for.

## When to use

Use this skill when the prompt carries many instructions, files, phases or acceptance criteria; when
two or more lanes can run concurrently; when the work needs adversarial review, repair loops or
mandatory gates; when it may outlive one context window, process or client; when repository changes
must be isolated among agents; or when hangs and stale workers need deterministic recovery.

Do not create a harness for a simple answer, a one-file mechanical edit, or a short diagnostic one
agent can finish and verify directly.

## Hard rules

1. Preserve the user's complete prompt as immutable bytes before summarizing or planning it.
2. Never treat agent prose as authoritative state or proof.
3. Never let an implementer validate its own work or feed its report into a validator packet, and
   never dispatch an implementer without its paired independent validator, eligible the instant that
   implementer submits — the Triad Floor and the pairing invariant are specified in
   [`references/protocol.md`](references/protocol.md).
4. Never dispatch overlapping write scopes in parallel.
5. Never mutate a run with an unauthenticated external tool; every mutation goes through the harness CLI.
6. Never call a model API or launch an LLM CLI. Dispatch only through the host's native subagent mechanism.
7. Never announce completion while the runtime reports a blocker.
8. Never present an invented value as a fact. A value nobody measured or reported is absent, and
   absent renders as "unknown". An estimate carries `evidence_class: "derived"` and `is_estimated: true`.
9. Describe mandatory gate evidence only as `trusted_host_observed_v1` — never as hermetic, sealed,
   sandboxed or reproducible. The restricted Git seam, and what repository discovery rejects before
   status, are specified in [`references/protocol.md`](references/protocol.md).
10. Scope a task's `--gate` to the tests covering that task's write scope, and have its validator run
    that gate rather than the suite. The whole-suite run is `plan:compile --completion-gate`, and it
    runs once, at the completion barrier. A repair round re-runs the task's gate plus any gate whose
    scope the repair touched — never everything.

## Route by role

Every agent holds exactly one role, and `roles/<role>.md` is its binding contract: what it `may` do,
what it `must_not` do, the exact commands it may invoke, and the roles it may branch into.
`task:claim --role` is checked against it — `implementer` for a ready or retry-ready task, `repairer`
for one in `changes_requested` — and a mismatch is refused.

Load your contract, your persona, and the reference in your row. **The "Never read" column is not
advice; it is the reason this table exists.**

| Role (tier)              | Contract + persona                                                                   | Read for the job                                                          | Never read                                                        |
| :----------------------- | :----------------------------------------------------------------------------------- | :------------------------------------------------------------------------ | :---------------------------------------------------------------- |
| `coordinator` (2)        | [roles/coordinator.md](roles/coordinator.md) + [agents/coordinator.yaml](agents/coordinator.yaml) | [run-playbook.md](references/run-playbook.md), [host-adapters.md](references/host-adapters.md) | Validator and critic protocols; it may not judge or write code    |
| `planner` (3)            | [roles/planner.md](roles/planner.md)                                                 | [schema-examples.md](references/schema-examples.md), playbook Phase 1     | Anything about validation, branches or sealing                    |
| `implementer` (3)        | [roles/implementer.md](roles/implementer.md) + [agents/worker.yaml](agents/worker.yaml) | Playbook Phases 3–4                                                       | `agents/validator.yaml`, `agents/critic.yaml`, the critic protocol |
| `repairer` (3)           | [roles/repairer.md](roles/repairer.md) + [agents/worker.yaml](agents/worker.yaml)    | The open findings (`finding:get`), then playbook Phase 3                  | Validator persona; a repairer never grades its own repair         |
| `validator` (3)          | [roles/validator.md](roles/validator.md) + [agents/validator.yaml](agents/validator.yaml) | Playbook Phase 5; the persona carries the dual-channel UI mandate         | Implementer prose and prior reviews — the packet strips them      |
| `completeness-critic` (3) | [roles/completeness-critic.md](roles/completeness-critic.md) + [agents/critic.yaml](agents/critic.yaml) | Playbook Phase 6, [schema-examples.md](references/schema-examples.md)     | Implementer reports; the critic judges the diff, not the story    |
| `sub-implementer` (3)    | [roles/sub-implementer.md](roles/sub-implementer.md)                                 | Playbook Phase 4 only                                                     | The parent task's plan, review and gate documents                 |
| `sub-validator` (3)      | [roles/sub-validator.md](roles/sub-validator.md)                                     | Playbook Phase 4 only                                                     | Verdict commands — it gathers evidence and issues no verdict      |
| `sub-investigator` (3)   | [roles/sub-investigator.md](roles/sub-investigator.md)                                | Playbook Phase 4 only                                                     | Anything that mutates; it reproduces, bisects and reports         |

[agents/orchestrator.yaml](agents/orchestrator.yaml) is the tier 1 meta-orchestrator persona for
multi-round loops, and [agents/openai.yaml](agents/openai.yaml) the Codex/ChatGPT profile.

A validator dispatched with `--validator-domain` carries one of five standing-checklist contracts
instead of the base one — [roles/validator-code-quality.md](roles/validator-code-quality.md),
[roles/validator-product.md](roles/validator-product.md),
[roles/validator-security.md](roles/validator-security.md),
[roles/validator-system-design.md](roles/validator-system-design.md),
[roles/validator-ui-design.md](roles/validator-ui-design.md) — chosen by the task's write scope
(B12). Role, tier and commands stay `validator`; only the prose and checklist differ.

## Route by phase

Full command sequences: [`references/run-playbook.md`](references/run-playbook.md). The rules each
phase enforces: [`references/protocol.md`](references/protocol.md).

| Phase                      | Commands                                                    | Read before acting                                                   |
| :------------------------- | :---------------------------------------------------------- | :------------------------------------------------------------------- |
| Capture, enhance, plan     | `plan:init`, `plan:enhance`, `plan:add`, `plan:compile`     | Playbook Phase 1, [schema-examples.md](references/schema-examples.md) |
| Dispatch continuously      | `queue:wave`, `agent:register`                              | Playbook Phase 2, [host-adapters.md](references/host-adapters.md)     |
| Implement                  | `task:claim`, `run:exec`, `task:submit`, `task:release`     | Playbook Phase 3 + your role contract                                 |
| Subdivide at execution time | `branch:open`, `branch:claim`, `branch:submit`, `branch:collect` | Playbook Phase 4, [state-model.md](references/state-model.md)     |
| Validate                   | `task:validate-start`, `task:probe`, `task:reject`, `task:review` | Playbook Phase 5, [agents/validator.yaml](agents/validator.yaml) |
| Replan after findings      | `critic:reject`, `plan:replan`                              | [protocol.md](references/protocol.md) fan-back section                |
| Seal                       | `critic:start`, `critic:review`, `run:complete`             | Playbook Phase 6                                                      |
| Recover, report            | `recover`, `doctor`, `summary:export`, `summary:view`       | Playbook Phase 7, [failure-modes.md](references/failure-modes.md)     |

## Reference index

- [`references/cli-capabilities.md`](references/cli-capabilities.md) — **the** command reference: every
  command, flag, stdin rule, exit code and example, generated from the command registry.
  [`references/cli-capabilities.json`](references/cli-capabilities.json) is the same manifest as data.
- [`references/cli.md`](references/cli.md) — how to reach that manifest, and the conventions holding
  for every command. It documents no command itself.
- [`references/run-playbook.md`](references/run-playbook.md) — the phases in order, with the command
  sequence for each.
- [`references/protocol.md`](references/protocol.md) — non-negotiable invariants, the evidence spine,
  the lifecycle, tiered dispatch and the pairing invariant, gate grammar, state transitions.
- [`references/state-model.md`](references/state-model.md) — run directory, task states, lease
  suspension, and the branch, agent, topology and planning ledgers.
- [`references/host-adapters.md`](references/host-adapters.md) — the two-tier architecture and
  main-thread isolation, host-native subagent adapters, heartbeats and recovery.
- [`references/failure-modes.md`](references/failure-modes.md) — the failure taxonomy this design
  exists to close, and the structural countermeasure for each.
- [`references/parity-matrix.md`](references/parity-matrix.md) — what each host provides, and what
  stays absent when it does not.
- [`references/schema-examples.md`](references/schema-examples.md) — canonical shapes for
  requirements, graphs, submissions, findings, reviews, branches, grants, topology and plans.
- [`references/configuration.md`](references/configuration.md) — `harness.config.json` keys, defaults,
  and what each one bounds.

## Before writing any command

Check the flag exists in [`references/cli-capabilities.json`](references/cli-capabilities.json), or
ask the harness live:

```bash
bun orchestrating-long-tasks/scripts/harness.ts help <command>
```

A flag that is not in the registry does not exist, however plausible it reads.
