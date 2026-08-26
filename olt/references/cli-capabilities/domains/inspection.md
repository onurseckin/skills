# CLI Capability Manifest — inspection

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).

### `finding:get`

Read one finding file, or every finding in the capsule.

Without an id the whole findings directory is listed.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--id` | string | no | no | - | Finding id or file name. |
| `--finding` | string | no | no | - | Alias of --id. |

```bash
bun harness.ts finding:get --run .olt/capsules/<run-id> --id finding-task-1
```

### `report:get`

Read a submission, review or critic report.

With --task the review report is preferred and the submission is used as the fallback; --critic reads the completeness review.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--task` | string | no | no | - | Task whose report is wanted. |
| `--critic` | bool | no | no | - | Read the critic review report. |
| `--submission` | bool | no | no | - | Force the submission report. |
| `--review` | bool | no | no | - | Force the review report. |
| `--type` | string | no | no | - | submission, review or critic. |
| `--stage` | string | no | no | - | Alias of --type. |
| `--report` | string | no | no | - | Explicit report file name. |
| `--id` | string | no | no | - | Alias of --report. |
| `--screenshots` | bool | no | no | - | Include screenshot records. |

```bash
bun harness.ts report:get --run .olt/capsules/<run-id> --task task-1 --type review
```

### `evidence:get`

Read recorded command evidence.

Filters the evidence directory by command id, task, gate or actor.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--command` | string | no | no | - | Command id. |
| `--id` | string | no | no | - | Alias of --command. |
| `--cmd` | string | no | no | - | Alias of --command. |
| `--task` | string | no | no | - | Filter by task id. |
| `--gate` | string | no | no | - | Filter by gate id. |
| `--actor` | string | no | no | - | Filter by actor. |
| `--screenshots` | bool | no | no | - | Include screenshot records. |

```bash
bun harness.ts evidence:get --run .olt/capsules/<run-id> --task task-1
```

### `evidence:screenshots`

List captured UI screenshots with their test ids and viewports.

Queries the screenshot store rather than the evidence files.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--task` | string | no | no | - | Filter by task id. |
| `--command` | string | no | no | - | Filter by command id. |
| `--cmd` | string | no | no | - | Alias of --command. |
| `--id` | string | no | no | - | Alias of --command. |
| `--actor` | string | no | no | - | Filter by actor. |

```bash
bun harness.ts evidence:screenshots --run .olt/capsules/<run-id> --task task-1
```
