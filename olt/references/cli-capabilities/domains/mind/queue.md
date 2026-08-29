# CLI Capability Manifest — mind (queue)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

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
