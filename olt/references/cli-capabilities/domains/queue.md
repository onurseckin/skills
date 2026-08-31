# CLI Capability Manifest — queue

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).

### `queue:next`

Show the highest-priority ready task without claiming it.

Reads the queue and reports the task a coordinator would dispatch next.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |

```bash
bun harness.ts queue:next --run .olt/capsules/<run-id>
```

### `queue:list`

Partition every task by queue status.

Groups tasks into ready, leased, validating, blocked and satisfied partitions with the blocking dependencies.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |

```bash
bun harness.ts queue:list --run .olt/capsules/<run-id>
```

### `queue:wave`

Show every task claimable right now, ranked by critical depth — for display only.

The readiness query: runs the scheduler over live task state and returns every task whose dependencies are done and whose write scope collides with nothing currently leased, ranked by critical depth and capped at max_parallel. Annotates each task with the wave plan:compile recorded, or reports the topology as absent, purely for display. This is not a batch to assemble and dispatch as one unit — claim each entry the moment an agent is free, and re-run this (or claim atomically with queue:pop / task:claim) the instant any agent finishes; never wait for the rest of one call's answer before claiming the next task. Read-only: each dispatched agent still claims its own task.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--max-parallel` | int | no | no | - | Occupancy ceiling for this query; defaults to the configured default_max_parallel. |

```bash
bun harness.ts queue:wave --run .olt/capsules/<run-id> --max-parallel 4
```

### `queue:pop`

Claim the highest-priority ready task and mint a lease token.

Atomically leases the next ready task to an agent. Fails when no task is ready rather than waiting.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--agent` | string | yes | no | - | Agent id receiving the lease. |
| `--lease-duration` | int | no | no | - | Lease length in seconds (5-86400). |
| `--lease-seconds` | int | no | no | `1200` | Alias of --lease-duration. |

```bash
bun harness.ts queue:pop --run .olt/capsules/<run-id> --agent worker-1 --lease-seconds 1800
```

### `queue:add`

Add a feedback item to the mind queue.

Appends a new feedback item to .olt/backlog.jsonl.

- **Aliases**: none
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
bun harness.ts queue:add --title 'Fix memory leak' --priority HIGH
```

### `queue:drain`

Drain and mark pending feedback items for execution.

Drains pending items from .olt/backlog.jsonl in FIFO order.

- **Aliases**: none
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
bun harness.ts queue:drain --authority-run <run>
bun harness.ts queue:drain --authority-run <run> --limit 3
```

### `queue:status`

List and inspect mind feedback queue items.

Lists active feedback items from the canonical feedback queue (.olt/backlog.jsonl).

- **Aliases**: none
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
bun harness.ts queue:status
```

### `queue:seal`

Seal completed queue items with empirical verification proofs.

Marks queue items completed and attaches proof records.

- **Aliases**: none
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
bun harness.ts queue:seal --authority-run <run> --id fb-123 --proof sha-abc
```

### `queue:clean`

Prune resolved items from queue into completed-tasks archive.

Moves sealed items from .olt/backlog.jsonl to .olt/completed-tasks.jsonl.

- **Aliases**: none
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
```
