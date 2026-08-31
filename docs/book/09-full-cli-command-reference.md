[← Previous: Chapter 08: Verification and Socratic Gating](08-verification-and-socratic-gating.md) | [Table of Contents](SUMMARY.md) | [Next: Chapter 10: Troubleshooting and Anti-Blunder Compendium →](10-troubleshooting-and-anti-blunder-compendium.md)

---

# Chapter 09: Full CLI Command Reference

This chapter is the **definitive reference manual** for the OLT Harness CLI (`bun olt/scripts/harness.ts`). All inter-agent coordination, lifecycle progression, file modifications, validation gates, and mental states are driven through strictly typed colon commands.

---

## 1. Global CLI Conventions & Exit Codes

### Invocation Syntax

```bash
bun olt/scripts/harness.ts <command> [flags] [-- <remainder_args>]
```

### Deterministic Exit Codes

OLT commands return standardized exit codes defined in `olt/scripts/src/cli/registry/types.ts`:

| Exit Code | Identifier           | Semantic Meaning                                                                                                                                                      |
| :-------- | :------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`       | `SUCCESS`            | Command completed successfully. Outputs human-readable markdown brief on stdout, or JSON when `--format json` is set.                                                 |
| `3`       | `REJECTED / INVALID` | Command rejected prior to state mutation due to `INVALID_ARGUMENT`, `INVALID_STATE`, `INTEGRITY`, `PATH_SAFETY`, `UNSUPPORTED_PLATFORM`, or `AUTHENTICATION_FAILURE`. |
| `4`       | `LOCK_TIMEOUT`       | The capsule lock file (`.olt/capsules/<run-id>/.lock`) was held by another process and could not be acquired before the deadline.                                     |
| `70`      | `NOT_IMPLEMENTED`    | Unimplemented command handler, or an unhandled critical exception.                                                                                                    |

---

## 2. Command Domains Reference

### 2.1. Domain: `plan` (Planning, Auditing & Graph Compilation)

The `plan` domain manages the prompt analysis, brainstorming vector expansion, requirement graphs, and DAG compilation.

| Command               | Summary & Description                                                           | Key Flags                                                              | Stdin                  |
| :-------------------- | :------------------------------------------------------------------------------ | :--------------------------------------------------------------------- | :--------------------- |
| `plan:brainstorm`     | Expands prompt into multi-vector failure mode analysis.                         | `--run <path>`, `--prompt <str>`, `--rounds <int>`                     | Yes (`--prompt-stdin`) |
| `orchestrate`         | Full automated pipeline: brainstorm $\to$ enhance $\to$ compile $\to$ validate. | `--prompt <str>`, `--run <path>`, `--auto-approve`                     | Yes                    |
| `plan:init`           | Initializes an empty planning buffer in the target run.                         | `--run <path>`, `--goal <str>`                                         | No                     |
| `plan:enhance`        | Enriches planning tasks with repository groundings and anchor files.            | `--run <path>`, `--prompt <str>`                                       | Yes                    |
| `plan:add`            | Appends a single task node to the active planning buffer.                       | `--run <path>`, `--task <id>`, `--write-scope <list>`, `--deps <list>` | No                     |
| `plan:audit`          | Runs invariant checks (granularity, gate discrimination, false barriers).       | `--run <path>`, `--strict`                                             | No                     |
| `plan:compile`        | Compiles planning buffer into the executable task DAG and waves.                | `--run <path>`, `--max-parallel <int>`, `--out <file>`                 | No                     |
| `plan:validate-start` | Begins independent plan validation by a `plan-validator`.                       | `--run <path>`, `--validator <id>`                                     | No                     |
| `plan:review`         | Approves or requests changes on the compiled DAG.                               | `--run <path>`, `--status <pass\|reject>`, `--reason <str>`            | No                     |
| `plan:replan`         | Injects repair tasks and bumps DAG graph revision ($R \to R+1$).                | `--run <path>`, `--findings-file <file>`, `--critic <id>`              | No                     |
| `plan:claim`          | Claims planning authority lock for a designated supervisor.                     | `--run <path>`, `--agent <id>`, `--role <role>`                        | No                     |
| `plan:apply`          | Commits an approved planning buffer into active execution state.                | `--run <path>`, `--token <token>`                                      | No                     |
| `plan:status`         | Displays planning buffer, audit findings, and compilation status.               | `--run <path>`, `--format <text\|json>`                                | No                     |

---

### 2.2. Domain: `queue` (Wave Concurrency & Task Scheduling)

The `queue` domain manages Brent work/span concurrency, task ready queues, and wave lanes.

| Command        | Summary & Description                                                           | Key Flags                                                    | Default |
| :------------- | :------------------------------------------------------------------------------ | :----------------------------------------------------------- | :------ |
| `queue:next`   | Retrieves the next claimable task for an agent.                                 | `--run <path>`, `--agent <id>`, `--role <role>`              | -       |
| `queue:list`   | Lists all tasks across all execution states.                                    | `--run <path>`, `--filter <status>`, `--format <text\|json>` | `text`  |
| `queue:wave`   | Computes and returns the next concurrent wave lane ($P \le \lceil W/S \rceil$). | `--run <path>`, `--max-parallel <int>`                       | `4`     |
| `queue:pop`    | Pops a ready task from the queue and claims it in one step.                     | `--run <path>`, `--agent <id>`, `--role <role>`              | -       |
| `queue:add`    | Injects a new dynamic task into the runtime task queue.                         | `--run <path>`, `--task <id>`, `--priority <int>`            | `50`    |
| `queue:drain`  | Flushes all unleased tasks from the ready queue.                                | `--run <path>`, `--reason <str>`                             | -       |
| `queue:status` | Returns queue depth, wave occupancy, and blocker metrics.                       | `--run <path>`                                               | -       |
| `queue:seal`   | Prevents further task additions to the queue for run wrap-up.                   | `--run <path>`, `--reason <str>`                             | -       |
| `queue:clean`  | Purges completed and abandoned task records from the active queue.              | `--run <path>`                                               | -       |

---

### 2.3. Domain: `task` (Task Leases, Execution & Review)

The `task` domain governs task claiming, heartbeats, submissions, and Socratic validations.

| Command                | Summary & Description                                                      | Key Flags                                                                                                              | Stdin |
| :--------------------- | :------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------- | :---- |
| `task:brief`           | Emits zero-exploration exact anchor briefing for a task.                   | `--run <path>`, `--task <id>`                                                                                          | No    |
| `task:claim`           | Claims a ready task and mints an active lease token.                       | `--run <path>`, `--task <id>`, `--agent <id>`, `--role <role>`, `--lease-seconds <int>`                                | No    |
| `task:heartbeat`       | Extends the deadline of an active task lease.                              | `--run <path>`, `--task <id>`, `--agent <id>`, `--token <token>`, `--extend-seconds <int>`                             | No    |
| `task:submit`          | Submits modified files for independent validation.                         | `--run <path>`, `--task <id>`, `--agent <id>`, `--token <token>`, `--summary <str>`, `--files-changed <list>`          | No    |
| `task:validate-start`  | Starts validation session under an independent validator.                  | `--run <path>`, `--task <id>`, `--validator <id>`                                                                      | No    |
| `task:review`          | Approves or rejects a task submission with evidence resolution.            | `--run <path>`, `--task <id>`, `--agent <id>`, `--token <token>`, `--status <pass\|reject>`, `--resolve <finding=cmd>` | No    |
| `task:probe`           | Issues a non-failing probe demand for rapid 1-hop micro-cycle.             | `--run <path>`, `--task <id>`, `--agent <id>`, `--demand <str>`                                                        | No    |
| `task:reject`          | Formally rejects a task and transfers to repair assignment.                | `--run <path>`, `--task <id>`, `--agent <id>`, `--reason <str>`, `--severity <sev>`, `--remediation <str>`             | No    |
| `task:assign-repairer` | Assigns an escalated task to a dedicated repairer agent.                   | `--run <path>`, `--task <id>`, `--repairer <id>`, `--max-rounds <int>`                                                 | No    |
| `task:abandon`         | Voluntarily abandons a task lease due to blockage.                         | `--run <path>`, `--task <id>`, `--agent <id>`, `--token <token>`, `--reason <str>`                                     | No    |
| `task:release`         | Releases an unmutated task back to `ready` for other agents.               | `--run <path>`, `--task <id>`, `--agent <id>`, `--token <token>`                                                       | No    |
| `task:check`           | Runs fast incremental typechecks and AST linting within task scope.        | `--run <path>`, `--task <id>`                                                                                          | No    |
| `task:add`             | Adds a task record directly to `state.json`.                               | `--run <path>`, `--task <id>`, `--write-scope <list>`                                                                  | No    |
| `task:list`            | Formats and outputs task state table.                                      | `--run <path>`, `--format <text\|json>`                                                                                | No    |
| `task:lease`           | Inspects current lease details and time remaining.                         | `--run <path>`, `--task <id>`                                                                                          | No    |
| `task:complete`        | Low-level direct transition of task to completed state (Harness internal). | `--run <path>`, `--task <id>`, `--token <token>`                                                                       | No    |
| `task:fail`            | Forces task into failed state after retry exhaustion.                      | `--run <path>`, `--task <id>`, `--reason <str>`                                                                        | No    |
| `task:prune`           | Removes orphaned task metadata.                                            | `--run <path>`, `--task <id>`                                                                                          | No    |

---

### 2.4. Domain: `run` & `shell` (Capsule Lifecycle & Monitored Execution)

| Command        | Summary & Description                                               | Key Flags                                                 | Remainder Args         |
| :------------- | :------------------------------------------------------------------ | :-------------------------------------------------------- | :--------------------- |
| `run:init`     | Initializes a new capsule directory structure and state.            | `--prompt <str>`, `--capsule-dir <path>`, `--title <str>` | Rejected               |
| `run:exec`     | Monitored shell command execution capturing falsifiable receipts.   | `--run <path>`, `--task <id>`, `--timeout-ms <int>`       | Forwarded (`-- <cmd>`) |
| `run:status`   | Outputs comprehensive telemetry, quota, and DAG status brief.       | `--run <path>`, `--format <text\|json>`                   | Rejected               |
| `run:complete` | Finalizes run after verifying all gates, doctor checks, and proofs. | `--run <path>`, `--critic <id>`, `--token <token>`        | Rejected               |
| `shell`        | Opens interactive debug shell inside the capsule context.           | `--run <path>`                                            | Rejected               |

---

### 2.5. Domain: `doctor` (Hygiene, Verification & Auto-Healing)

| Command         | Summary & Description                                                   | Key Flags                  | Healing Action                            |
| :-------------- | :---------------------------------------------------------------------- | :------------------------- | :---------------------------------------- |
| `doctor`        | Runs all diagnostic checks (locks, AST, mailboxes, worktrees).          | `--run <path>`, `--fix`    | Cleans stale locks, purges dead IPC files |
| `doctor:verify` | Read-only verification that `Healthy: yes` holds for run.               | `--run <path>`, `--strict` | None (Exits 0 or 3)                       |
| `doctor:repair` | Aggressively repairs corrupted capsule state and unmerged git branches. | `--run <path>`, `--force`  | Re-aligns `state.json` event head         |

---

### 2.6. Domain: `mind` & `factory` (Autonomous Supervisor & Memory)

| Command             | Summary & Description                                           | Key Flags                                                  |
| :------------------ | :-------------------------------------------------------------- | :--------------------------------------------------------- |
| `memory:query`      | Queries persistent cross-run semantic vector memory.            | `--query <str>`, `--limit <int>`, `--domain <str>`         |
| `mind:init`         | Initializes Tier 0 Autonomous Mind governance state.            | `--run <path>`, `--charter <file>`                         |
| `mind:wake`         | Triggers autonomous supervisor wake-up and triage cycle.        | `--run <path>`, `--agent <id>`                             |
| `mind:pulse-open`   | Opens a new cognitive telemetry observation pulse.              | `--run <path>`, `--pulse-id <id>`                          |
| `mind:pulse`        | Emits an intermediate cognitive observation heartbeat.          | `--run <path>`, `--status <str>`, `--notes <str>`          |
| `mind:observe`      | Ingests external system observation into working memory.        | `--run <path>`, `--observation <str>`, `--source <src>`    |
| `mind:candidate`    | Registers an exploratory task candidate for consideration.      | `--run <path>`, `--candidate-id <id>`, `--rationale <str>` |
| `mind:admit`        | Admits an approved candidate into the active planning buffer.   | `--run <path>`, `--candidate-id <id>`                      |
| `mind:decline`      | Declines and archives an unapproved task candidate.             | `--run <path>`, `--candidate-id <id>`, `--reason <str>`    |
| `mind:quiesce`      | Quiesces all supervisor operations for low-power idle.          | `--run <path>`, `--reason <str>`                           |
| `mind:escalate`     | Escalates an unresolvable systemic deadlock to human operator.  | `--run <path>`, `--issue <str>`, `--severity <sev>`        |
| `mind:halt`         | Emergency halts all active execution waves immediately.         | `--run <path>`, `--reason <str>`                           |
| `mind:round-open`   | Opens a new cognitive audit round.                              | `--run <path>`, `--round <int>`                            |
| `mind:round-close`  | Closes and scores the current cognitive audit round.            | `--run <path>`, `--score <float>`                          |
| `mind:audit-start`  | Starts an asynchronous charter alignment audit.                 | `--run <path>`, `--auditor <id>`                           |
| `mind:audit-report` | Publishes structured findings from a completed cognitive audit. | `--run <path>`, `--report-file <path>`                     |
| `mind:rotate`       | Rotates supervisor lease credentials for security.              | `--run <path>`, `--agent <id>`                             |
| `smart-task:plan`   | Autonomous heuristic work/span DAG optimizer.                   | `--run <path>`, `--max-span <int>`                         |
| `smart-task:ingest` | Batch ingests user requirements into smart task planner.        | `--run <path>`, `--file <path>`                            |
| `mind:audit:live`   | Streams real-time cognitive state telemetry to stdout.          | `--run <path>`, `--interval-ms <int>`                      |
| `factory:preplan`   | Pre-compiles factory task templates for standard workflows.     | `--template <name>`, `--out <path>`                        |
| `factory:status`    | Reports factory template cache utilization.                     | `--format <text\|json>`                                    |

---

### 2.7. Domain: `msg` (Flock Mailbox Inter-Agent IPC)

| Command    | Summary & Description                                        | Key Flags                                                                                      | Stdin                |
| :--------- | :----------------------------------------------------------- | :--------------------------------------------------------------------------------------------- | :------------------- |
| `msg:send` | Sends a message packet to a recipient agent mailbox.         | `--run <path>`, `--from <id>`, `--to <id>`, `--subject <str>`, `--body <str>`, `--type <type>` | Yes (`--body-stdin`) |
| `msg:recv` | Reads and consumes the next message from own mailbox.        | `--run <path>`, `--agent <id>`, `--peek`                                                       | No                   |
| `msg:poll` | Polls mailbox and returns message count and unread subjects. | `--run <path>`, `--agent <id>`                                                                 | No                   |
| `msg:list` | Lists all messages in an agent's inbox without consuming.    | `--run <path>`, `--agent <id>`, `--format <text\|json>`                                        | No                   |

---

### 2.8. Domain: `worktree` (Isolated Concurrent Git Worktrees)

| Command           | Summary & Description                                          | Key Flags                                          |
| :---------------- | :------------------------------------------------------------- | :------------------------------------------------- |
| `worktree:create` | Provisions an isolated git worktree for a parallel task.       | `--run <path>`, `--task <id>`, `--branch <branch>` |
| `worktree:land`   | Merges and reconciles a task worktree back into target branch. | `--run <path>`, `--task <id>`, `--squash`          |
| `worktree:list`   | Lists active worktree paths and lease associations.            | `--run <path>`, `--format <text\|json>`            |
| `worktree:clean`  | Removes orphaned worktree directories and branches.            | `--run <path>`, `--force`                          |
| `worktree:status` | Reports git status and uncommitted files across all worktrees. | `--run <path>`                                     |

---

## 3. Flag Type Definitions & Parsing Rules

1. **String Flags (`string`)**: Passed as `--flag value` or `--flag=value`. Whitespace strings must be enclosed in quotes.
2. **Integer Flags (`int`)**: Passed as `--flag 42`. Non-numeric or floating-point values cause an immediate `INVALID_ARGUMENT` (Exit Code 3).
3. **Boolean Flags (`bool`)**: Specified as a standalone flag `--strict` (true) or omitted (false). Explicit boolean arguments (`--strict=true`, `--strict=false`) are supported.
4. **List / Repeatable Flags (`list`)**: Can be specified multiple times (`--write-scope file1.ts --write-scope file2.ts`) or comma-separated (`--write-scope file1.ts,file2.ts`).

---

[← Previous: Chapter 08: Verification and Socratic Gating](08-verification-and-socratic-gating.md) | [Table of Contents](SUMMARY.md) | [Next: Chapter 10: Troubleshooting and Anti-Blunder Compendium →](10-troubleshooting-and-anti-blunder-compendium.md)
