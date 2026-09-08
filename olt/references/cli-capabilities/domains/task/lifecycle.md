# CLI Capability Manifest — task (lifecycle)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

### `task:claim`

Lease a specific ready task under a declared role.

Transitions the task to leased and returns the bearer token the agent must echo back.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--task` | string | yes | no | - | Task id to claim. |
| `--agent` | string | yes | no | - | Agent id receiving the lease. |
| `--role` | string | yes | no | - | Role contract the agent claims under. |
| `--lease-duration` | int | no | no | - | Lease length in seconds (5-86400). |
| `--lease-seconds` | int | no | no | `1200` | Alias of --lease-duration. |

```bash
bun harness.ts task:claim --run <run> --task t1 --agent w1 --role imp
```

### `task:heartbeat`

Extend a live lease so a long edit does not expire.

Requires the lease token; a stale or foreign token is refused.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--task` | string | yes | no | - | Leased task id. |
| `--agent` | string | yes | no | - | Agent holding the lease. |
| `--token` | string | yes | no | - | Lease bearer token. |

```bash
bun harness.ts task:heartbeat --run <run> --task t1 --token <tok>
```

### `task:submit`

Submit completed task work for validation.

Records the submission report, audits write-scope compliance, and moves the task to submitted.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--task` | string | yes | no | - | Leased task id. |
| `--agent` | string | yes | no | - | Agent holding the lease. |
| `--token` | string | yes | no | - | Lease bearer token. |
| `--summary` | string | no | no | - | What the agent changed. |
| `--evidence` | string | no | yes | - | Recorded command id proving the work. |
| `--files-changed` | string | no | yes | - | Repository-relative path the agent changed. |
| `--report` | string | no | no | - | Path to a complete submission report payload. |
| `--no-op` | bool | no | no | - | Declares the write scope legitimately needed no change. |
| `--reason` | string | no | no | - | Why --no-op is true. |

```bash
bun harness.ts task:submit --run <run> --task t1 --summary "Done"
```

### `task:release`

Hand a live lease back without waiting for it to expire.

The voluntary counterpart to `recover`. Requires the live lease token; the task returns to retry_ready, or to changes_requested when the released attempt was a repair. A branched task cannot be released - collect or abandon the branch first.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--task` | string | yes | no | - | Leased task id. |
| `--agent` | string | yes | no | - | Agent holding the lease. |
| `--token` | string | yes | no | - | Lease bearer token. |

```bash
bun harness.ts task:release --run <run> --task t1 --agent w1
```

### `task:lease`

Claim an active lease on a task in the queue.

Claims an exclusive active lease on a task for an agent worker.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--task` | string | no | no | - | Task ID. |
| `--task-id` | string | no | no | - | Alias for task ID. |
| `--agent-id` | string | no | no | - | Agent ID claiming the lease. |
| `--lease-duration` | int | no | no | - | Lease duration in seconds. |
| `--duration-seconds` | int | no | no | - | Alias of lease duration. |
| `--queue-path` | string | no | no | - | Custom task queue file path. |
| `--path` | string | no | no | - | Alias for queue-path. |
| `--run` | string | no | no | - | Capsule run root or custom queue path. |
| `--trace-id` | string | no | no | - | Trace correlation ID. |
| `--span-id` | string | no | no | - | Span ID. |
| `--parent-span-id` | string | no | no | - | Parent span correlation ID. |
| `--trace-sampled` | bool | no | no | - | Sampled tracing flag. |

```bash
bun harness.ts task:lease --task task-1 --agent-id worker-1
```
