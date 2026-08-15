# 02. Comprehensive CLI Command Reference Manual

[⬅ Previous: Complete End-to-End Tutorial](./01-end-to-end-tutorial.md) | [Master Table of Contents](../README.md) | [Next: Troubleshooting & FAQ ➡](./03-troubleshooting-and-faq.md)

---

## 📖 CLI Grammar & Invocation Patterns

The `orchestrating-long-tasks` CLI is executed via the pinned runtime inside each run capsule:

```bash
bun orchestrating-long-tasks/scripts/harness.ts <subcommand> [flags...] [-- <argv...>]
```

All CLI commands output machine-parseable JSON lines (`{"ok": true, "result": ...}`) on stdout, or structured errors (`{"ok": false, "error": {"code": ...}}`) on stderr.

---

## 📑 Core Command Catalog

### 1. Run Lifecycle & Status
- **`init`**: Initialize a new run capsule from an immutable prompt file.
  - Flags: `--run <path>`, `--prompt <path>`, `--actor <name>`
- **`status`**: Output complete task counts, integrity audit, and recent event stream.
  - Flags: `--run <path>`
- **`complete`**: Evaluate the 8-point terminal completion checklist.
  - Flags: `--run <path>`, `--actor <name>`
- **`recover`**: Reclaim expired leases, terminate orphaned processes, and quarantine torn event tails.
  - Flags: `--run <path>`, `--actor <name>`, `[--grace-seconds <N>]`

### 2. Planning & Graph Scheduling
- **`plan-apply`**: Apply and validate requirements and task graph with atomic revision locking.
  - Flags: `--run <path>`, `--requirements <path>`, `--graph <path>`, `--expected-revision <N>`, `--actor <name>`
- **`ready`**: List eligible tasks whose dependencies are satisfied without mutating state.
  - Flags: `--run <path>`, `--max-parallel <N>`
- **`schedule`**: Transition eligible tasks from `proposed` to `ready`.
  - Flags: `--run <path>`, `--max-parallel <N>`, `--actor <name>`

### 3. Task Execution & Leasing
- **`claim`**: Lease an available task for finite duration and issue a bearer token.
  - Flags: `--run <path>`, `--task <id>`, `--agent <id>`, `--role <implementer|planner>`
- **`heartbeat`**: Extend an active lease before expiration.
  - Flags: `--run <path>`, `--task <id>`, `--token <bearer-token>`
- **`packet`**: Generate a sanitised role-specific markdown instruction packet.
  - Flags: `--run <path>`, `--task <id>`, `--role <role>`, `--agent <id>`, `--token <token>`, `--id <packet-id>`
- **`submit`**: Implementer submits task completion report and evidence.
  - Flags: `--run <path>`, `--task <id>`, `--agent <id>`, `--token <token>`, `--report <path>`

### 4. Validation & Gate Attachment
- **`begin-validation`**: Authorize an independent validator and issue a validation token.
  - Flags: `--run <path>`, `--task <id>`, `--validator <id>`
- **`review`**: Validator records pass verdict or structured rejection findings.
  - Flags: `--run <path>`, `--task <id>`, `--validator <id>`, `--token <token>`, `--review <path>`
- **`gate`**: Attach passing command evidence to satisfy a task-level mandatory gate.
  - Flags: `--run <path>`, `--task <id>`, `--gate <gate-id>`, `--command-id <cmd-id>`, `--actor <name>`
- **`run-gate`**: Attach passing command evidence to satisfy a global run-level gate.
  - Flags: `--run <path>`, `--gate <gate-id>`, `--command-id <cmd-id>`, `--actor <name>`
- **`finish`**: Transition task from `gating` to `done` once all reviews and gates pass.
  - Flags: `--run <path>`, `--task <id>`, `--actor <name>`

### 5. Watchdog Command Runner
- **`run`**: Execute a command under fail-closed process monitoring, logging, and repository binding.
  - Flags: `--run <path>`, `--actor <id>`, `[--task <id>]`, `[--gate <id>]`, `--cwd <dir>`, `[--wall-ms <N>]`, `[--idle-ms <N>]`
  - Remainder: `-- <executable> [args...]`

---

[⬅ Previous: Complete End-to-End Tutorial](./01-end-to-end-tutorial.md) | [Master Table of Contents](../README.md) | [Next: Troubleshooting & FAQ ➡](./03-troubleshooting-and-faq.md)
