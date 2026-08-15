# 02. Comprehensive CLI Command Reference Manual

[⬅ Previous: Complete End-to-End Tutorial](./01-end-to-end-tutorial.md) | [Master Table of Contents](../README.md) | [Next: Troubleshooting & FAQ ➡](./03-troubleshooting-and-faq.md)

---

## 📖 Zero-JSON CLI Grammar & Invocation Patterns

The `orchestrating-long-tasks` CLI provides domain-specific colon commands designed for direct agent consumption. Instead of authoring large JSON payloads, all interactions use concise CLI flags and emit compact Markdown briefs ($\le 30$ lines):

```bash
bun harness.ts <domain:command> [flags...] [-- <argv...>]
```

---

## 📑 Complete Command Catalog

### 1. Planning & Decomposition

- **`plan:init`**: Initialize a new run capsule with byte-exact prompt capture.
  - Flags: `--repo <path>`, `--run <slug>`, `--prompt-stdin`
- **`plan:add`**: Register a task with disjoint write scopes and mandatory gates.
  - Flags: `--run <path>`, `--actor <name>`, `--id <task-id>`, `--label "<label>"`, `--scope <path>`, `--gate "<gate-cmd>"`, `[--deps <dep-id>]`
- **`plan:status`**: Output current draft planning buffer and task table.
  - Flags: `--run <path>`
- **`plan:compile`**: Compile dependency DAG with 100% line disposition coverage verification.
  - Flags: `--run <path>`, `--actor <name>`

### 2. Queue & Dispatch Management

- **`queue:next`**: Query the next ready task unblocked in the dependency graph.
  - Flags: `--run <path>`
- **`queue:list`**: List all currently queued, ready, or leased tasks across waves.
  - Flags: `--run <path>`
- **`queue:pop`**: Pop the highest-priority conflict-free task and lease it to a worker.
  - Flags: `--run <path>`, `--agent <worker-id>`, `[--lease-seconds <N>]`

### 3. Task Implementation & Submission

- **`task:claim`**: Explicitly lease a ready task to an assigned agent.
  - Flags: `--run <path>`, `--task <task-id>`, `--agent <worker-id>`, `[--lease-seconds <N>]`
- **`task:heartbeat`**: Extend an active task lease during ongoing execution.
  - Flags: `--run <path>`, `--task <task-id>`, `--agent <worker-id>`, `--token <bearer-token>`
- **`task:submit`**: Submit finished implementation work with diff verification.
  - Flags: `--run <path>`, `--task <task-id>`, `--agent <worker-id>`, `--token <bearer-token>`, `--summary "<summary>"`

### 4. Independent Validation & Bounded Repair

- **`task:validate-start`**: Dispatch an independent validator with a fresh validation token.
  - Flags: `--run <path>`, `--task <task-id>`, `--validator <val-id>`
- **`task:review`**: Record validator approval following successful gate runs.
  - Flags: `--run <path>`, `--task <task-id>`, `--validator <val-id>`, `--token <val-token>`, `--status pass`, `--summary "<summary>"`
- **`task:reject`**: Reject task submission with structured remediation findings.
  - Flags: `--run <path>`, `--task <task-id>`, `--validator <val-id>`, `--token <val-token>`, `--reason "<reason>"`, `--finding "<remediation>"`

### 5. Monitored Execution & Run Lifecycle

- **`run:exec`**: Execute commands under watchdog monitoring and capture `trusted_host_observed_v1` evidence.
  - Flags: `--run <path>`, `--actor <id>`, `[--task <task-id>]`, `[--gate <gate-id>]`, `-- <argv...>`
- **`run:status`**: Output complete task states, findings, and gate results.
  - Flags: `--run <path>`
- **`critic:start`**: Begin completeness critic review session.
  - Flags: `--run <path>`, `--critic <critic-id>`
- **`critic:review`**: Submit final completeness critic audit decision.
  - Flags: `--run <path>`, `--critic <critic-id>`, `--token <critic-token>`, `--decision <approve|reject>`, `--summary "<summary>"`
- **`run:complete`**: Mechanically evaluate the 8-point checklist and seal the run.
  - Flags: `--run <path>`, `--actor <name>`

---

[⬅ Previous: Complete End-to-End Tutorial](./01-end-to-end-tutorial.md) | [Master Table of Contents](../README.md) | [Next: Troubleshooting & FAQ ➡](./03-troubleshooting-and-faq.md)
