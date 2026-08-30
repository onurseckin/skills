# CLI Capability Manifest — mind (round)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

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
| `--result` | string | no | no | `converged` | Round result (converged \| exhausted \| escalated). |
| `--terminal-reason` | string | no | no | - | Reason if round terminates without successor. |
| `--successor-run` | string | no | no | - | Successor capsule run id. |

```bash
bun harness.ts mind:round-close --run .olt/capsules/mind-gen-1 --actor mind-1 --objective obj-1 --round 1 --terminal-reason "objective completed"
```
