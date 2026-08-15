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
|    ➜ Owns capsule lifecycle: plan:init, plan:add, plan:compile, run:complete                   |
|    ➜ Manages waves & dispatches work via queue:pop / task:claim                               |
|    ➜ Reports back to Tier 1 ONLY at major milestones (Plan Ready, Wave Done, Final Sign-off)  |
|                      │                                                                        |
|                      ▼                                                                        |
|  [ Tier 3: Ephemeral Worker & Validator Subagents ]                                           |
|    ➜ Implementers: leased disjoint write scopes, task:heartbeat, task:submit                 |
|    ➜ Validators: independent adversarial checks, run:exec, task:review, task:reject          |
|    ➜ Completeness Critic: critic:start, critic:review                                         |
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
|    ➜ native subagents           ➜ agent teams / forks    ➜ native workers      ➜ coding agent |
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
- Dispatches teammates using Claude Code's agent team tools. Teammates claim disjoint write scopes; the lead coordinator validates.

### 3. OpenAI Codex & ChatGPT

- Discovered at `.agents/skills/orchestrating-long-tasks` or `~/.agents/skills/...`.
- Uses native subagent collaboration channels to process role briefs and report command evidence.

---

## 🔀 Sequential Fallback Mode

If a developer runs the harness in an environment where multi-agent concurrency is unavailable (e.g. single-agent CLI mode), the harness automatically switches to **Sequential Execution**:

- The single agent processes ready tasks one at a time.
- When switching between the **Implementer** role and the **Validator** role, the agent must perform a **Context Reset** (clearing conversational memory) to prevent self-grading contamination.
- If independence cannot be guaranteed, validation remains blocked rather than allowing self-approval.

---

[⬅ Previous: Plan Revision & Freezing](../03-graph-scheduler/03-plan-revision-and-freezing.md) | [Master Table of Contents](../README.md) | [Next: Role Briefs & Two-Tier Architecture ➡](./02-immutable-role-packets.md)
