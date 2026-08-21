# Host Capability Parity Matrix

What each supported host provides, and what the harness therefore expects from it. The harness never
spawns an agent itself: every row below is a host mechanism the coordinator drives, with the harness
recording the result.

## Dispatch and isolation

| Capability                          |       Google Antigravity       |               Anthropic Claude Code               |   OpenAI Codex / ChatGPT   |    Generic subagent CLI    |
| :---------------------------------- | :----------------------------: | :-----------------------------------------------: | :------------------------: | :------------------------: |
| **Tiered orchestration**            |   Native (`invoke_subagent`)   |               Native (`Agent` tool)               | Native (subagent dispatch) | Scripted fork / subprocess |
| **Paired continuous dispatch**      | One `invoke_subagent` per pair |           Concurrent `Agent` tool calls           |        Batch runner        |        Process pool        |
| **Sub-agents for branch sub-tasks** |    Nested `invoke_subagent`    |             Nested `Agent` tool calls             |      Nested dispatch       |       Nested process       |
| **Direct messaging to the parent**  |         `send_message`         | `SendMessage`; experimental Agent Teams mailboxes |           Direct           |         IPC / pipe         |
| **Main-thread isolation**           |        Background tree         |                  Background tree                  |      Background tree       |     Detached processes     |

## Evidence the host is expected to report

| Reported through                                           | What it carries                                       | When it is absent                                                      |
| :--------------------------------------------------------- | :---------------------------------------------------- | :--------------------------------------------------------------------- |
| `agent:register --model / --model-tier / --thinking-level` | Model identity for one agent (`agent_reported`)       | The field stays absent and renders as "unknown"                        |
| `agent:register --tool`                                    | The toolset the dispatcher granted (`agent_reported`) | No toolset is recorded for that grant                                  |
| `agent:report --tokens-in / --tokens-out`                  | Running totals as relayed (`agent_reported`)          | No token counts; `--tokens-estimated` marks a derived estimate instead |
| `agent:register --parent-agent / --parent-task`            | Lineage: who deployed this agent, onto what           | Only a root agent may omit the parent                                  |

No host is required to report telemetry. A host that reports none still gets a correct graph — it
simply shows "unknown" where a model would be. Nothing is inferred from the machine that exports the
run.

## Harness capabilities available on every host

These are properties of the harness, not of the host, so they hold identically everywhere:

| Capability                                                     | Command surface                                                                                     |
| :------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------- |
| Immutable prompt capture and integrity chain                   | `plan:init`, `doctor`                                                                               |
| Reviewable repository reading                                  | `plan:enhance`                                                                                      |
| Recorded topology and continuous readiness dispatch            | `plan:compile`, `queue:wave`                                                                        |
| Asymmetric branch-and-collect                                  | `branch:open`, `branch:claim`, `branch:submit`, `branch:collect`, `branch:abandon`, `branch:status` |
| Grant ledger and lineage                                       | `agent:register`, `agent:report`, `agent:release`, `agent:list`                                     |
| Adversarial probe, then bounded repair                         | `task:probe`, `task:reject`, `task:review`                                                          |
| Monitored gate execution with evidence ingestion               | `run:exec`, `evidence:get`, `evidence:screenshots`, `report:get`                                    |
| Cascading scope-aware replanning                               | `critic:reject`, `plan:replan`                                                                      |
| Deterministic recovery                                         | `task:release`, `recover`                                                                           |
| Graph export for the viewer                                    | `summary:export`, `summary:view`                                                                    |
| POSIX inode kernel locking (`flock`)                           | every mutating command                                                                              |
| Markdown briefs of at most 30 lines, `--format json` on demand | every command                                                                                       |

## Host requirements

A host is usable with this skill when all of the following hold:

1. It can spawn several subagents concurrently from one call, so a wave is not serialised.
2. Subagents can run a shell command (`bun harness.ts ...`) and read its stdout.
3. A subagent can be handed a secret string (its lease token) out of band from its prompt file.
4. The coordinator can stay resident for the whole run rather than being replaced per task.
5. Bun 1.3.0 or newer is on `PATH` for the harness itself.

A host missing (1) still works, at the cost of the parallelism the topology recorded. A host missing
(4) cannot hold the coordinator role and should drive the run through `orchestrator:run` with its own
round executor instead.
