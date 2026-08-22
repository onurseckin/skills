# 01. Host-Agnostic Architecture & Adapters

[⬅ Previous: Plan Revision & Freezing](../03-graph-scheduler/03-plan-revision-and-freezing.md) | [Master Table of Contents](../README.md) | [Next: Role Briefs & Two-Tier Architecture ➡](./02-immutable-role-packets.md)

---

## 🚫 Why the Harness Never Calls LLM APIs Directly

A common flaw in agent orchestration frameworks is hardcoding direct API calls to OpenAI, Anthropic, or Google, or attempting to spawn CLI subshells like `claude` or `codex` internally.

This approach creates severe issues:

- **Credential Leakage:** Requires API keys to be embedded into filesystem scripts.
- **Platform Inflexibility:** Binds the system to one vendor's rate limits and billing models.
- **Process Shadowing:** The host application loses visibility into subagent lifecycles and token consumption.

Instead, `orchestrating-long-tasks` is **100% Host-Agnostic and Zero-Dependency**:

- The harness **never** makes HTTP model calls or launches LLM CLIs.
- The harness operates through a **Zero-JSON colon CLI** that manages deterministic state machines on disk.
- The **host developer application** (Google Antigravity, Claude Code, OpenAI Codex, ChatGPT) uses its own native subagent mechanism to dispatch workers.

This has one unavoidable consequence: **the run only knows what the dispatcher tells it.** Spawning happens host-side, so an agent exists in the capsule because someone ran `agent:register`, and its model, tier, thinking level and token counts exist because someone reported them. Nothing is inferred from the machine that happens to be running the export. See [Chapter 09 §02](../09-branching-and-honesty/02-agent-grant-ledger.md).

---

## 📡 Telemetry Evidence Classes: What Was Reported vs. What Was Measured

Every field on an agent grant record carries the evidence class of _how the harness came to know it_,
never just its value:

- **`agent_reported`** — the dispatcher (or the agent itself, via `agent:report`) told the harness,
  on `agent:register --model`, `--provider`, `--model-tier`, `--thinking-level`, `--context-window`
  or `--tool`. This is the CLI surface, and it is the only surface where a caller can type a value
  that turns out not to be true — a nonexistent model id typed here is recorded exactly as though the
  host had attested to it, so `agent_reported` is a **claim**, not a verification. The one exception:
  an explicit `unknown` thinking-level or tier value keeps evidence class `unknown`, because stating
  "I don't know" is not an unverified claim of fact.
- **`host_reported` / `derived` / `harness_observed`** — earned _only_ by an automatic probe the
  harness itself runs, never by anything a CLI flag supplied. `agent:register`, `agent:release`,
  `task:claim` and `task:submit` all call this probe on every invocation, automatically, without a
  round-trip back to the agent — `agent:report` (the mid-flight tool/token check-in) does **not**;
  it only ever records the caller's own self-reported numbers as `agent_reported`. The probe: it
  reads the host's own configuration files (session concurrency
  limits, per-agent definition files, feature flags — one detector per host, keyed by a `host_tool`
  string, never a TypeScript type) and, separately, the host's own on-disk transcript for that
  specific agent id (real token usage, the exact model id, real tool calls with success/failure).
  When a probed value disagrees with an already-recorded `agent_reported` value, neither is
  discarded — the disagreement is appended to `telemetry_conflicts` on the grant, and an explicit
  report always wins the _field_ while the conflict stays visible for an operator to see later.

The practical read: an agent's own self-report of its model or token spend should be treated as a
claim until the automatic probe corroborates it (or contradicts it). A run whose host publishes
nothing usable — no known config, no transcript for that agent id — simply carries fewer telemetry
fields, never a guessed one.

Tool usage follows the same open-vocabulary discipline as everything else in this harness:
`--tool <name>=<category>` accepts any category string, not a closed enum (`browser-automation`,
`shell`, `test-runner` and a dozen others are merely the seeded, recognised set) — a category outside
that set is recorded exactly as given, never dropped or coerced into the nearest known one.
`--tool-extra <tool>:<key>=<value>` records one tool-specific fact verbatim under the reporter's own
key name, and refuses if the named tool was never declared with `--tool` in the same call.

---

## 👥 The Two-Tier Agent Architecture

To prevent conversational context explosion and preserve interactive responsiveness for the developer, the harness enforces a strict 3-tier hierarchy:

```text
+-----------------------------------------------------------------------------------------------+
|                                 TWO-TIER AGENT ARCHITECTURE                                   |
+-----------------------------------------------------------------------------------------------+
|                                                                                               |
|  [ Tier 1: Main Interactive Chat ]  <---> [ Human Developer ]                                 |
|    ➜ Pure conversation & status updates                                                       |
|    ➜ Spawns exactly ONE background child                                                      |
|    ➜ Zero worker tool churn or polling loops in chat window                                   |
|                      │                                                                        |
|                      ▼                                                                        |
|  [ Tier 2: Background Run Coordinator ]                                                       |
|    ➜ Owns capsule lifecycle: plan:init, plan:enhance, plan:add, plan:compile, run:complete    |
|    ➜ Dispatches each claimable task via queue:wave; registers every agent with agent:register |
|    ➜ Reports to Tier 1 ONLY at milestones (Plan Compiled, Queue Drained, Final Sign-off)      |
|                      │                                                                        |
|                      ▼                                                                        |
|  [ Tier 3: Ephemeral Worker, Validator & Critic Subagents ]                                   |
|    ➜ Plan-validator: adversary for the compiled plan, before any implementer dispatches       |
|    ➜ Implementers: leased disjoint write scopes, task:heartbeat, task:submit                 |
|    ➜ Validators: independent checks, run:exec, task:probe, task:reject, task:review          |
|    ➜ Repairers: claim changes_requested under --role repairer                                |
|    ➜ Completeness critic: critic:review / critic:reject with structured findings              |
|                      │                                                                        |
|                      ▼                                                                        |
|  [ Branch children of a lease-holding tier 3 agent ]                                          |
|    ➜ sub-implementer / sub-investigator: branch:claim, run:exec, branch:submit                |
|                                                                                               |
+-----------------------------------------------------------------------------------------------+
```

---

## 🔌 Supported Host Environments

```text
+-----------------------------------------------------------------------------------------------+
|                                      HOST ADAPTER ARCHITECTURE                                |
+-----------------------------------------------------------------------------------------------+
|                                                                                               |
|  [ Google Antigravity ]       [ Claude Code ]          [ OpenAI Codex ]      [ ChatGPT ]      |
|    ➜ native subagents           ➜ the `Agent` tool       ➜ native workers      ➜ coding agent |
|    ➜ ~/.gemini/config/skills    ➜ .claude/skills         ➜ .agents/skills      ➜ .agents/skills|
|             │                         │                        │                    │         |
|             └─────────────────────────┼────────────────────────┴────────────────────┘         |
|                                       │ (Zero-JSON Colon CLI)                                 |
|                                       ▼                                                       |
|                     +-----------------------------------+                                     |
|                     |        PINNED HARNESS RUNTIME     |                                     |
|                     | orchestrating-long-tasks/scripts/harness.ts |                                     |
|                     +-----------------------------------+                                     |
|                                                                                               |
+-----------------------------------------------------------------------------------------------+
```

### 1. Google Antigravity

- Discovered globally at `~/.gemini/config/skills/orchestrating-long-tasks` or pinned runtime.
- Uses native `invoke_subagent` / `send_message` tools to dispatch workers.
- Lead agent acts as the Tier 2 Coordinator, managing subagents and state transitions.

### 2. Claude Code

- Discovered at `.claude/skills/orchestrating-long-tasks` or `~/.claude/skills/...`.
- Dispatches subagents with the native `Agent` tool; each claims a disjoint write scope and the lead
  coordinator validates. `SendMessage` and the experimental Agent Teams file-mailbox channel are for
  agent-to-agent messaging, not dispatch — see [`references/host-adapters.md`](../../references/host-adapters.md)'s
  adapter table for the full, current detail.

### 3. OpenAI Codex & ChatGPT

- Discovered at `.agents/skills/orchestrating-long-tasks` or `~/.agents/skills/...`.
- Uses native subagent collaboration channels to process role briefs and report command evidence.

---

## 🔀 Sequential Fallback Mode

If a developer runs the harness in an environment where multi-agent concurrency is unavailable (e.g. single-agent CLI mode), the harness automatically switches to **Sequential Execution**:

- The single agent processes ready tasks one at a time.
- When switching between the **Implementer** role and the **Validator** role, the agent must perform a **Context Reset** (clearing conversational memory) to prevent self-grading contamination, and must use a **different agent id** — `task:validate-start` refuses a validator that appears in the task's attempts, and refuses one that already validated the task in an earlier round.
- If independence cannot be guaranteed, validation remains blocked rather than allowing self-approval.

---

## 🩺 Autonomous Supervision (B27 / B28)

Everything above this line describes a coordinator driving dispatch by hand, one `task:claim` at a
time. `orchestrator:supervise` is the alternative: a single reclaim-classify-dispatch pass over a
run's eligible set, safe to drive from an external poll loop (cron, a shell `while`) because a call
with no injected dispatcher performs exactly one pass and returns.

```bash
bun harness.ts orchestrator:supervise --run .capsules/<run-id> --actor coordinator
```

One pass does three things, in order:

1. **Reclaims dead agents.** A lease whose holder never submitted and never heartbeat past expiry is
   reclaimed the same way `recover` already does — this is the automatic counterpart to that manual
   command.
2. **Escalates deterministic dead ends (B28.3).** Every dispatch failure is recorded as its own event
   (there is no dedicated state field for it — a dispatch can fail before a task lease even exists, so
   there's nothing on the task record to attach it to). A failure is classified `transient` or
   `deterministic` from that history: `rate_limit`, `network`, `provider_5xx` and `timeout` are
   transient _without limit on retry count_ — a provider having a bad moment doesn't get more broken
   the more times the identical message repeats, so only elapsed wall-clock time (default 4 hours) can
   ever demote them. `crash` is transient too, but _is_ subject to a consecutive-repeat cap (default 3) — an agent dying identically several times in a row for the same task is evidence about the
   task, unlike a provider outage. Every other signal (a failed gate, an auth rejection) starts
   deterministic. A task judged deterministic is escalated out of automatic circulation — pulled from
   dispatch, its reason recorded, waiting for a human — never retried forever.
3. **Reports what's dispatchable.** Same readiness query `queue:wave` runs, annotated with which
   backed-off tasks are still cooling down before their next retry.

`--no-recover` is the one opt-out (recovery is on by default, B28.5). `--max-parallel` and
`--gate-max-parallel` set the two independent occupancy ceilings this run enforces: a general
reasoning ceiling (host-discovered when not overridden — the harness reads the host's own published
per-session concurrency limit, e.g. Codex's `max_concurrent_threads_per_session`, rather than
hardcoding a number) and a separate, lower, CPU-bound ceiling for gate-running work (derived from
local core count, since a test suite or `tsc` run competes for _this machine's_ CPU, not a provider's
queue). Precedence between an explicit `--max-parallel`/`--gate-max-parallel` flag, a repo's
`harness.config.json`, and this host-discovered default is a task-execution-chapter concern; what
matters here is that both ceilings are reported side by side, so idle reasoning capacity sitting next
to a saturated gate ceiling is visible, not silently absorbed into one number.

`orchestrator:run` is the sibling command for a fresh capsule: it drives plan → execute → validate →
critic rounds until the critic approves or the round budget (default 10) is spent. Both commands
require the **host** to inject the actual work — a `TaskDispatcher` for `orchestrator:supervise`, a
round executor for `orchestrator:run` — because dispatching a task always means real host work
(spawning and running an actual agent), and the harness itself never does it; without one, both
commands refuse outright rather than pretending a round ran.

---

[⬅ Previous: Plan Revision & Freezing](../03-graph-scheduler/03-plan-revision-and-freezing.md) | [Master Table of Contents](../README.md) | [Next: Role Briefs & Two-Tier Architecture ➡](./02-immutable-role-packets.md)
