# CLI Capability Manifest — task (review)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

### `task:validate-start`

Dispatch an independent validator against a submitted task.

Assigns the validator and mints the validation token required by task:review.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--task` | string | yes | no | - | Submitted task id. |
| `--validator` | string | yes | no | - | Validator agent id. |
| `--lease-duration` | int | no | no | - | Validation window in seconds. |
| `--validator-domain` | string | no | no | - | B12.2 standing checklist domain. |

```bash
bun harness.ts task:validate-start --run .olt/capsules/<run-id> --task task-1 --validator val-1
```

### `task:review`

Record a validator verdict with its gate evidence.

Records pass or fail verdict along with evidence findings.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--task` | string | yes | no | - | Task under validation. |
| `--validator` | string | yes | no | - | Validator agent id. |
| `--token` | string | yes | no | - | Validation token. |
| `--status` | string | yes | no | - | pass or fail. |
| `--summary` | string | no | no | - | Verdict summary. |
| `--severity` | string | no | no | - | critical, important or minor. |
| `--remediation` | string | no | no | - | What would fix the defect. |
| `--revalidation` | string | no | no | - | How the fix is to be proven. |
| `--evidence` | string | no | no | - | Comma-separated command ids proving the verdict. |
| `--checks` | string | no | no | - | Alias of --evidence. |
| `--finding-id` | string | no | no | - | Explicit finding id for a failing verdict. |
| `--requirement` | string | no | no | - | Requirement a failing verdict binds its finding to. |
| `--resolve` | string | no | yes | - | Answer an open finding. |
| `--resolution-method` | string | no | yes | - | How a finding was answered. |
| `--checklist-domain` | string | no | no | - | Standing checklist domain. |
| `--checklist-report` | string | no | no | - | Path to a JSON checklist report file. |
| `--require-semantic-depth` | bool | no | no | - | Enforce strict semantic depth audits. |
| `--kind` | string | no | no | - | Review channel kind: cognitive or adversarial. |
| `--micro-cycle` | bool | no | no | - | Record micro-cycle feedback within active lease. |
| `--in-lease` | bool | no | no | - | Alias of --micro-cycle. |
| `--defect` | string | no | no | - | Identified defect category or description. |
| `--max-rounds` | int | no | no | - | Maximum micro-cycle rounds allowed. |

```bash
bun harness.ts task:review --run .olt/capsules/<run-id> --task task-1 --validator val-1 --token <token> --status pass --summary "All pass"
```
