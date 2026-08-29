# CLI Capability Manifest — task (terminal)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

### `task:abandon`

Close an open attempt nobody submitted or released, on the coordinator's authority.

Forced counterpart to task:release for unsticking abandoned tasks.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--task` | string | yes | no | - | Task with an open attempt. |
| `--actor` | string | yes | no | - | Who is abandoning the attempt. |
| `--reason` | string | yes | no | - | Why the attempt is being abandoned. |

```bash
bun harness.ts task:abandon --run .olt/capsules/<run-id> --task task-1 --actor coordinator --reason "agent crashed"
```

### `task:complete`

Mark a task as completed in the queue.

Records task completion, unblocks downstream dependents, and optionally archives the task.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--task` | string | no | no | - | Task ID to complete. |
| `--task-id` | string | no | no | - | Alias of task ID. |
| `--agent-id` | string | no | no | - | Agent ID completing the task. |
| `--lease-token` | string | no | no | - | Active lease token. |
| `--token` | string | no | no | - | Alias of lease token. |
| `--proof-summary` | string | no | no | - | Summary proof of task completion. |
| `--test-path` | string | no | no | - | Test file path demonstrating completion. |
| `--commit-sha` | string | no | no | - | Commit SHA associated with completion. |
| `--auto-archive` | bool | no | no | - | Automatically archive completed task. |
| `--auto-prune` | bool | no | no | - | Automatically prune completed task from queue. |
| `--completed-tasks-path` | string | no | no | - | Completed tasks archive file path. |
| `--archive-path` | string | no | no | - | Alias of completed tasks archive path. |
| `--queue-path` | string | no | no | - | Custom task queue file path. |
| `--path` | string | no | no | - | Alias for queue-path. |

```bash
bun harness.ts task:complete --task task-1 --proof-summary "All tests pass"
```

### `task:fail`

Mark a task as failed in the queue.

Transitions task to failed or increments retry count if retries remain.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--task` | string | no | no | - | Task ID to fail. |
| `--task-id` | string | no | no | - | Alias of task ID. |
| `--message` | string | no | no | - | Failure error message. |
| `--error` | string | no | no | - | Alias of error message. |
| `--reason` | string | no | no | - | Alias of error message. |
| `--agent-id` | string | no | no | - | Agent ID recording failure. |
| `--lease-token` | string | no | no | - | Active lease token. |
| `--token` | string | no | no | - | Alias of lease token. |
| `--can-retry` | bool | no | no | - | Allow task retry if retry count permits. |
| `--escalate` | bool | no | no | - | Escalate task upon reaching max retries. |
| `--queue-path` | string | no | no | - | Custom task queue file path. |
| `--path` | string | no | no | - | Alias for queue-path. |

```bash
bun harness.ts task:fail --task task-1 --message "Test failure"
```

### `task:prune`

Prune completed tasks from the queue.

Removes completed tasks from the active queue and archives them to completed log.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--completed-tasks-path` | string | no | no | - | Completed tasks archive file path. |
| `--archive-path` | string | no | no | - | Alias of completed tasks archive path. |
| `--auto-archive` | bool | no | no | - | Archive completed tasks before pruning. |
| `--queue-path` | string | no | no | - | Custom task queue file path. |
| `--path` | string | no | no | - | Alias for queue-path. |

```bash
bun harness.ts task:prune
```
