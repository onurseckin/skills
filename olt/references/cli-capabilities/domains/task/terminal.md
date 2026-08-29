# CLI Capability Manifest — task (terminal)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

### `task:abandon`

Close an open attempt nobody submitted or released, on the coordinator's authority.

The forced counterpart to task:release: it does not require the lease token, only --actor and --reason, because it exists for a coordinator to unstick a task whose attempt is open but whose agent is gone or unresponsive. The task returns to retry_ready, or to changes_requested when the abandoned attempt was a repair. Refuses if the task's most recent attempt is already closed - there is nothing left open to abandon.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--task` | string | yes | no | - | Task with an open attempt. |
| `--actor` | string | yes | no | - | Who is abandoning the attempt. Recorded on the event. |
| `--reason` | string | yes | no | - | Why the attempt is being abandoned. |

```bash
bun harness.ts task:abandon --run .olt/capsules/<run-id> --task task-1 --actor coordinator --reason "agent-1 crashed mid-attempt and will not return"
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
bun harness.ts task:release --run .olt/capsules/<run-id> --task task-1 --agent worker-1 --token <token>
```
