# CLI Capability Manifest — mind

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).

### `memory:query`

Query indexed cross-run knowledge, decisions, and memory documents.

Performs full-text retrieval and ranking across knowledge base, charter, findings, decisions, and past run summaries with zero external file reads required.

- **Aliases**: `memory:search`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--query` | string | no | no | - | Search query terms. |
| `--run` | string | no | no | - | Filter by capsule run root. |
| `--capsules-dir` | string | no | no | - | Override capsules root directory. |
| `--repo` | string | no | no | - | Repository root path. |
| `--kind` | string | no | no | - | Filter by document kind. |
| `--limit` | int | no | no | `10` | Maximum number of search results. |
| `--min-score` | string | no | no | - | Minimum similarity/match score threshold. |
| `--all` | bool | no | no | - | Display all matching documents without truncation. |
| `--now` | string | no | no | - | Timestamp override (ISO8601). |

```bash
bun harness.ts memory:query --query "authentication refactor"
bun harness.ts memory:query --query "rate limit" --limit 5
```

### `mind:init`

Initialize a mind capsule from an owner charter.

Validates the markdown charter file per CONTRACTS.md §7, creates the mind capsule (mind-gen-<generation>), pins the charter digest into manifest.json, seeds the state projection, and writes the initial last_pulse.json.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--repo` | string | yes | no | - | Repository root the mind serves. |
| `--charter` | string | yes | no | - | Path to the owner's charter file. |
| `--actor` | string | yes | no | - | Recorded on mind-initialized. |
| `--mind-id` | string | no | no | `mind-gen-1` | Mind capsule run id; defaults to mind-gen-1. |
| `--capsules-dir` | string | no | no | - | Override .olt/capsules/ directory location. |

```bash
bun harness.ts mind:init --repo . --charter olt/agents/mind.yaml --actor owner
```

### `mind:wake`

Produce the Tier A orientation brief and reclaim expired pulses.

Inspects the mind capsule state and budget, reclaims any open pulse past its deadline via mind-pulse-reclaimed, and outputs the Tier A orientation brief ending in prescribed next actions.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | no | no | - | Recorded only if the call reclaims a dead pulse. |
| `--depth` | string | no | no | `brief` | Orientation depth: brief (default) or run. |
| `--target-run` | string | no | no | - | With --depth run, the run capsule whose handoff to render. |

```bash
bun harness.ts mind:wake --run .olt/capsules/mind-gen-1
```

### `mind:pulse-open`

Open an active mind pulse under budget constraints.

Opens a new pulse cycle, validating budget headroom, daily pulse and wall-clock caps, quiet hours, and charter digest consistency before appending mind-pulse-opened.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | yes | no | - | The tier-0 agent id. |
| `--host` | string | yes | no | - | Host runtime as reported. |
| `--driver` | string | yes | no | - | Driver identity as reported. |

```bash
bun harness.ts mind:pulse-open --run .olt/capsules/mind-gen-1 --actor mind-1 --host antigravity --driver bash-loop
```

### `mind:pulse`

Unified perpetual mind pulse: report active telemetry or open a new pulse.

Unified perpetual mind pulse command. If a pulse is open, outputs active pulse telemetry and next scheduled interval. If no pulse is open, automatically opens a new perpetual pulse. Enforces CLOSING_FORBIDDEN_FOR_MIND invariant.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | no | no | `mind-1` | The acting agent id. |
| `--host` | string | no | no | `antigravity` | Host runtime as reported. |
| `--driver` | string | no | no | `perpetual-loop` | Driver identity as reported. |
| `--arm` | string | no | no | - | Scheduled duration for the next interval, e.g. 15m. |
| `--arm-mechanism` | string | no | no | - | How the pulse was armed, as reported. |
| `--now` | string | no | no | - | Timestamp override (ISO8601). |

```bash
bun harness.ts mind:pulse --run .olt/capsules/mind-gen-1 --actor mind-1
bun harness.ts mind:pulse --run .olt/capsules/mind-gen-1 --arm 15m
```

### `mind:observe`

Record a discovery source scan count evidenced by a command record.

Records an observation from one of the ten discovery sources evidenced by a recorded command id, appending mind-observed.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | yes | no | - | Acting agent. |
| `--source` | string | yes | no | - | One of the ten source ids in PLAN.md §7.2. |
| `--command-id` | string | yes | no | - | The recorded command whose output this is. |
| `--count` | int | yes | no | - | How many items that source returned. |

```bash
bun harness.ts mind:observe --run .olt/capsules/mind-gen-1 --actor mind-1 --source intent-drift --command-id cmd-41 --count 0
```

### `mind:candidate`

Record a discovery candidate (defect or proposal).

Proposes a defect or proposal candidate. Defects require a witness command record and falsifier argv. Validates charter goal alignment and write scope before recording mind-candidate-opened.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | yes | no | - | Acting agent. |
| `--kind` | string | yes | no | - | Candidate kind: defect or proposal. |
| `--statement` | string | yes | no | - | One line statement, recorded agent_reported. |
| `--witness` | string | no | no | - | Command id evidencing the defect; required unless --kind proposal. |
| `--charter-goal` | string | yes | yes | - | Goal ids from the pinned charter; repeat for multiple. |
| `--falsifier` | string | no | no | - | Argv that fails now and would pass if fixed (defects only). |
| `--write-scope` | string | yes | yes | - | Paths the work would touch; repeat for multiple. |
| `--rationale` | string | no | no | - | Proposals only. |

```bash
bun harness.ts mind:candidate --run .olt/capsules/mind-gen-1 --actor mind-1 --kind defect --statement "typecheck fails" --witness cmd-123 --charter-goal G1 --falsifier "bun run typecheck" --write-scope olt/scripts/src/health/
```

### `mind:admit`

Run admission gates on a candidate and admit it.

Runs the six admission gates (falsifier verification, scope disjointness, charter alignment, etc.) in order and admits the candidate, appending mind-candidate-admitted.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | yes | no | - | Acting agent. |
| `--candidate` | string | yes | no | - | Candidate id. |

```bash
bun harness.ts mind:admit --run .olt/capsules/mind-gen-1 --actor mind-1 --candidate cand-12
```

### `mind:decline`

Permanently decline a candidate with a recorded reason.

Marks a candidate permanently declined with a recorded reason and gate failure attribution, appending mind-candidate-declined.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | yes | no | - | Acting agent. |
| `--candidate` | string | yes | no | - | Candidate id. |
| `--reason` | string | yes | no | - | Reason why candidate was declined. |

```bash
bun harness.ts mind:decline --run .olt/capsules/mind-gen-1 --actor mind-1 --candidate cand-12 --reason "scope overlaps active lease"
```

### `mind:quiesce`

Record a verified quiescent observation across all ten discovery sources.

Records that all ten discovery sources were scanned and found clean with zero items, appending mind-quiesced.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | yes | no | - | Acting agent. |
| `--source` | string | yes | yes | - | Source scan result as <source>:<command-id>:<count>; repeat for each of the ten sources. |

```bash
bun harness.ts mind:quiesce --run .olt/capsules/mind-gen-1 --actor mind-1 --source intent-drift:cmd-1:0 --source unassigned-todos:cmd-2:0
```

### `mind:escalate`

Record an escalation and append to escalation log.

Records an escalation event in the hash chain and appends the escalation reason to escalation.md.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | yes | no | - | Acting agent. |
| `--reason` | string | yes | no | - | Reason for escalation. |
| `--severity` | string | no | no | - | Severity of escalation. |

```bash
bun harness.ts mind:escalate --run .olt/capsules/mind-gen-1 --actor mind-1 --reason "budget exhausted unexpectedly"
```

### `mind:halt`

Halt mind pulse execution and suppress successor arming.

Halts the mind run, suppresses further autonomous pulse arming, records mind-halted, and updates last_pulse.json with next_wake_at set to null.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | yes | no | - | Acting agent. |
| `--reason` | string | yes | no | - | Reason for halting. |

```bash
bun harness.ts mind:halt --run .olt/capsules/mind-gen-1 --actor mind-1 --reason "critical safety check failure"
```

### `mind:round-open`

Open a multi-pulse round for an objective.

Opens a new execution round for an objective in Phase 4, linking the round to its target capsule and appending mind-round-opened.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | yes | no | - | Acting agent. |
| `--objective` | string | yes | no | - | Objective id. |
| `--candidate` | string | no | no | - | Candidate id. |
| `--round` | int | yes | no | - | Round index. |
| `--target-run` | string | no | no | - | Chained-from capsule run id. |

```bash
bun harness.ts mind:round-open --run .olt/capsules/mind-gen-1 --actor mind-1 --objective obj-1 --round 1
```

### `mind:round-close`

Close a multi-pulse round for an objective.

Closes an active execution round for an objective in Phase 4, recording successor objective or terminal reason, appending mind-round-closed.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | yes | no | - | Acting agent. |
| `--objective` | string | yes | no | - | Objective id. |
| `--round` | int | yes | no | - | Round index. |
| `--result` | string | no | no | `converged` | Round result (converged | exhausted | escalated). |
| `--terminal-reason` | string | no | no | - | Reason if round terminates without successor. |
| `--successor-run` | string | no | no | - | Successor capsule run id. |

```bash
bun harness.ts mind:round-close --run .olt/capsules/mind-gen-1 --actor mind-1 --objective obj-1 --round 1 --terminal-reason "objective completed"
```

### `mind:audit-start`

Start an independent audit cycle over recent pulses.

Initiates an independent audit cycle in Phase 5, recording window start time and auditor identity, appending mind-audit-started.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | yes | no | - | Auditor agent id. |
| `--audit-id` | string | yes | no | - | Audit id. |
| `--window-start` | string | yes | no | - | Window start timestamp (ISO8601). |

```bash
bun harness.ts mind:audit-start --run .olt/capsules/mind-gen-1 --actor auditor-1 --audit-id audit-1 --window-start 2026-08-21T00:00:00Z
```

### `mind:audit-report`

Submit findings and verdict for an audit cycle.

Records the eight audit answers with supporting command ids and overall verdict in Phase 5, appending mind-audit-reported.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | yes | no | - | Auditor agent id. |
| `--audit-id` | string | yes | no | - | Audit id. |
| `--verdict` | string | yes | no | - | Audit verdict: approved or failed. |
| `--answer` | string | yes | yes | - | One of eight audit question answers as <question-id>:<command-id>:<verdict>; repeat for all eight. |

```bash
bun harness.ts mind:audit-report --run .olt/capsules/mind-gen-1 --actor auditor-1 --audit-id audit-1 --verdict approved --answer Q1:cmd-10:pass
```

### `mind:rotate`

Rotate generation N capsule into generation N+1.

Performs generational rotation, carrying forward charter pin and declined candidates while preserving auditability.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The current generation capsule root. |
| `--next-run` | string | yes | no | - | The next generation capsule root. |
| `--actor` | string | yes | no | - | Acting agent id. |

```bash
bun harness.ts mind:rotate --run .olt/capsules/mind-gen-1 --next-run .olt/capsules/mind-gen-2 --actor coordinator-1
```

### `smart-task:plan`

Autonomously synthesize self-evolution tasks or plan from feedback queue.

Smart task planner: prioritizes feedback intake, or synthesizes autonomic self-evolution tasks on empty queue.

- **Aliases**: `task:synthesize`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--capsules-dir` | string | no | no | - | Capsules root directory. |
| `--max-tasks` | int | no | no | - | Maximum tasks to generate (default: 5). |
| `--goal` | string | no | no | - | Charter goal ID to bind. |

```bash
bun harness.ts smart-task:plan
bun harness.ts smart-task:plan --max-tasks 3
```

### `smart-task:ingest`

Ingest and enhance an external prompt into a gate-verifiable task plan.

Expands an external prompt into a structured task with write scope and mandatory gate.

- **Aliases**: `smart-task:expand`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--prompt` | string | yes | no | - | External prompt or task description. |
| `--id` | string | no | no | - | Custom task ID. |
| `--goal` | string | no | no | - | Charter goal ID to bind. |

```bash
bun harness.ts smart-task:ingest --prompt 'Implement real-time metrics telemetry' --id task-metrics
```

### `mind:queue:list`

List and inspect mind feedback queue items.

Lists active feedback items from the canonical feedback queue (.olt/backlog.jsonl).

- **Aliases**: `todo:list`, `feedback:list`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--status` | string | no | no | - | Filter by item status. |
| `--priority` | string | no | no | - | Filter by priority level. |
| `--category` | string | no | no | - | Filter by category. |
| `--queue-file` | string | no | no | - | Override queue file path. |
| `--queue-path` | string | no | no | - | Alias for --queue-file. |
| `--all` | bool | no | no | - | Show all items without pagination. |
| `--limit` | int | no | no | - | Maximum items to display. |

```bash
bun harness.ts mind:queue:list
bun harness.ts todo:list
bun harness.ts feedback:list
```

### `mind:queue:add`

Add a feedback item to the mind queue.

Appends a new feedback item to .olt/backlog.jsonl.

- **Aliases**: `todo:add`, `feedback:ingest`, `feedback:add`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--title` | string | yes | no | - | Title of the feedback item. |
| `--content` | string | no | no | - | Content or body of the feedback item. |
| `--description` | string | no | no | - | Detailed description of the feedback. |
| `--priority` | string | no | no | - | Priority level: CRITICAL, HIGH, NORMAL, LOW. |
| `--category` | string | no | no | - | Feedback category. |
| `--id` | string | no | no | - | Explicit item ID override. |
| `--queue-file` | string | no | no | - | Override queue file path. |
| `--queue-path` | string | no | no | - | Alias for --queue-file. |

```bash
bun harness.ts mind:queue:add --title 'Fix memory leak' --priority HIGH
```

### `mind:queue:drain`

Drain and mark pending feedback items for execution.

Drains pending items from .olt/backlog.jsonl in FIFO order.

- **Aliases**: `todo:drain`, `feedback:drain`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--authority-run` | string | yes | no | - | Capsule run whose active Mind grant authorizes this mutation. |
| `--actor` | string | no | no | - | Explicit acting Mind identity; must match the verified session when supplied. |
| `--limit` | int | no | no | `5` | Maximum items to drain. |
| `--mark-as` | string | no | no | - | Target status: PROCESSED, IN_PROGRESS, ADMITTED. |
| `--category` | string | no | no | - | Filter by category. |
| `--priority` | string | no | no | - | Filter by priority level. |
| `--queue-file` | string | no | no | - | Override queue file path. |
| `--queue-path` | string | no | no | - | Alias for --queue-file. |

```bash
bun harness.ts mind:queue:drain --authority-run <run>
bun harness.ts todo:drain --authority-run <run> --limit 3
```

### `mind:queue:seal`

Seal completed queue items with empirical verification proofs.

Marks queue items completed and attaches proof records.

- **Aliases**: `todo:seal`, `feedback:seal`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--authority-run` | string | yes | no | - | Capsule run whose active Mind grant authorizes this mutation. |
| `--actor` | string | no | no | - | Explicit acting Mind identity; must match the verified session when supplied. |
| `--id` | string | yes | no | - | Feedback item ID to seal. |
| `--proof` | string | no | no | - | Commit SHA or test receipt proving resolution. |
| `--resolution` | string | no | no | - | Resolution description. |
| `--commit` | string | no | no | - | Commit SHA proving resolution. |
| `--test-path` | string | no | no | - | Test file path proving resolution. |
| `--assertions` | string | no | no | - | Number of test assertions verified. |
| `--runtime-ms` | string | no | no | - | Execution duration in milliseconds. |
| `--note` | string | no | no | - | Resolution notes. |
| `--summary` | string | no | no | - | Summary of resolution. |
| `--queue-file` | string | no | no | - | Override queue file path. |
| `--queue-path` | string | no | no | - | Alias for --queue-file. |

```bash
bun harness.ts mind:queue:seal --authority-run <run> --id fb-123 --proof sha-abc
```

### `mind:queue:clean`

Prune resolved items from queue into completed-tasks archive.

Moves sealed items from .olt/backlog.jsonl to .olt/completed-tasks.jsonl.

- **Aliases**: `todo:clean`, `feedback:clean`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--authority-run` | string | yes | no | - | Capsule run whose active Mind grant authorizes this mutation. |
| `--actor` | string | no | no | - | Explicit acting Mind identity; must match the verified session when supplied. |
| `--force` | bool | no | no | - | Force clean all completed items. |
| `--dry-run` | bool | no | no | - | Simulate clean without mutating files. |
| `--queue-file` | string | no | no | - | Override queue file path. |
| `--queue-path` | string | no | no | - | Alias for --queue-file. |
| `--archive-file` | string | no | no | - | Override archive destination file. |

```bash
bun harness.ts mind:queue:clean --authority-run <run>
bun harness.ts todo:clean --authority-run <run>
```

### `mind:audit:live`

Live Tier 0 out-of-band audit of mind liveness, stagnation, and Mode A/B injection.

Evaluates idle duration against >120s stagnation threshold and builds verbatim role prompt.

- **Aliases**: `mind:audit`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--repo` | string | no | no | - | Repository root path. |
| `--threshold` | int | no | no | `120` | Stagnation threshold in seconds (default: 120). |
| `--conversation-id` | string | no | no | - | Target conversation identifier. |
| `--json` | bool | no | no | - | Output structured JSON. |

```bash
bun harness.ts mind:audit:live
bun harness.ts mind:audit:live --threshold 60 --json
```
