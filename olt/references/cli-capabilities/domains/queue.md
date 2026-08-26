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
