# 02. Role Briefs & Task Execution Contracts

[⬅ Previous: Host-Agnostic Architecture](./01-host-agnostic-architecture.md) | [Master Table of Contents](../README.md) | [Next: Bearer Token Security ➡](./03-bearer-token-security.md)

---

## 📄 Zero-JSON CLI & Compact Markdown Briefs

Rather than requiring agents to construct and write large JSON files or parse separate multi-page packet files from disk, the modern harness CLI directly outputs **Compact Markdown Briefs ($\le 30$ lines)** directly to stdout upon lease acquisition:

```text
### Task Leased: task-auth-session
- Agent: worker-1
- Lease Token: DL1UOpoktcMRt_AhFJ0gwclQ56FLvxmhZPQV9Zdxa6o
- Duration: 20 minutes
- Assigned Write Scope: src/auth/session
- Note: Pass --token <token> to task:submit.
```

This design keeps agent context windows lean, reduces token consumption by over 90%, and eliminates JSON parsing errors.

---

## 🎭 The 5 Core Role Specifications

The harness defines five specialized roles across the orchestration lifecycle:

```text
+-----------------------------------------------------------------------------------------------+
|                                      THE 5 CORE ROLES                                         |
+-----------------------------------------------------------------------------------------------+
|                                                                                               |
|  1. Planner              ---> Registers modular tasks & compiles DAG (plan:add, plan:compile) |
|  2. Implementer          ---> Leases disjoint scope, executes work (task:claim, task:submit) |
|  3. Independent Validator---> Runs mandatory gates adversarially (task:validate-start, review)|
|  4. Repairer             ---> Fixes structured findings (configurable, default max 5 rounds)  |
|  5. Completeness Critic  ---> Verifies end-to-end prompt completion (critic:start, review)   |
|                                                                                               |
+-----------------------------------------------------------------------------------------------+
```

---

## ⚙️ Configurable Repair Limits (`harness.config.json`)

If an independent validator rejects a submission, the task transitions to `changes_requested`. The maximum number of allowable repair rounds is configured in `harness.config.json`:

```json
{
  "max_repair_rounds": 5,
  "max_output_bytes": 10485760,
  "default_lease_seconds": 1800,
  "default_max_parallel": 4,
  "strict_validation": true
}
```

- **Default:** 5 repair rounds.
- **Escalation:** If a task fails 5 consecutive validation rounds without passing, the state machine transitions the task to `escalated` to prevent runaway token spend.

---

## 📜 Universal Invariants for Worker Subagents

Every worker subagent operating in the harness adheres to fundamental execution invariants:

- **Exclusive Write Scope:** Treat the assigned write scope as an exclusive lease. Never edit, format, or delete any file outside it.
- **Direct Argv Execution:** Commands are executed through `run:exec` as direct argv arrays without unsafe shell interpolation.
- **Focused Verification:** Implementers verify their own changes using focused tests within their scope; whole-repo completion gates are run by the Tier 2 Coordinator.
- **Token Confidentiality:** Plaintext bearer tokens must only be passed as CLI arguments to `task:submit`, `task:review`, `task:reject`, or `critic:review`. Never log tokens in git commits or chat messages.

---

[⬅ Previous: Host-Agnostic Architecture](./01-host-agnostic-architecture.md) | [Master Table of Contents](../README.md) | [Next: Bearer Token Security ➡](./03-bearer-token-security.md)
