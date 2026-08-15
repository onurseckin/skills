# 01. Host-Agnostic Architecture & Adapters

[⬅ Previous: Plan Revision & Freezing](../03-graph-scheduler/03-plan-revision-and-freezing.md) | [Master Table of Contents](../README.md) | [Next: Immutable Role Packets ➡](./02-immutable-role-packets.md)

---

## 🚫 Why the Harness Never Calls LLM APIs Directly

A common flaw in agent orchestration frameworks is hardcoding direct API calls to OpenAI, Anthropic, or Google, or attempting to spawn CLI subshells like `claude` or `codex` internally.

This approach creates severe issues:

- **Credential Leakage:** Requires API keys to be embedded into filesystem scripts.
- **Platform Inflexibility:** Binds the system to one vendor's rate limits and billing models.
- **Process Shadowing:** The host application loses visibility into subagent lifecycles and token consumption.

Instead, `orchestrating-long-tasks` is **100% Host-Agnostic and Zero-Dependency**:

- The harness **never** makes HTTP model calls or launches LLM CLIs.
- The harness produces **immutable task packets and state machines on disk**.
- The **host developer application** (Google Antigravity, Claude Code, OpenAI Codex, ChatGPT) uses its own native subagent mechanism to dispatch workers.

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
|                                       │ (Reads packets & executes commands)                   |
|                                       ▼                                                       |
|                     +-----------------------------------+                                     |
|                     |        PINNED HARNESS RUNTIME     |                                     |
|                     | orchestrating-long-tasks/scripts/harness.ts |                                     |
|                     +-----------------------------------+                                     |
|                                                                                               |
+-----------------------------------------------------------------------------------------------+
```

### 1. Google Antigravity

- Discovered globally at `~/.gemini/config/skills/orchestrating-long-tasks`.
- Uses native `invoke_subagent` / `send_message` tools to dispatch workers.
- The lead agent acts as the Coordinator, advancing the harness state machine.

### 2. Claude Code

- Discovered at `.claude/skills/orchestrating-long-tasks` or `~/.claude/skills/...`.
- Dispatches teammates using Claude Code's agent team tools. Teammates claim disjoint write scopes; the lead merges and validates.

### 3. OpenAI Codex & ChatGPT

- Discovered at `.agents/skills/orchestrating-long-tasks` or `~/.agents/skills/...`.
- Uses native subagent collaboration channels to deliver role packets and report command evidence.

---

## 🔀 Sequential Fallback Mode

If a developer runs the harness in an environment where multi-agent concurrency is unavailable (e.g. single-agent CLI mode), the harness automatically switches to **Sequential Execution**:

- The single agent processes ready tasks one at a time.
- When switching between the **Implementer** role and the **Validator** role, the agent must perform a **Context Reset** (clearing conversational memory) to prevent self-grading contamination.
- If independence cannot be guaranteed, validation remains blocked rather than allowing self-approval.

---

[⬅ Previous: Plan Revision & Freezing](../03-graph-scheduler/03-plan-revision-and-freezing.md) | [Master Table of Contents](../README.md) | [Next: Immutable Role Packets ➡](./02-immutable-role-packets.md)
