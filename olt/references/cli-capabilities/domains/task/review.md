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
| `--validator-domain` | string | no | no | - | B12.2 standing checklist domain (code-quality, product, security, system-design, ui-design); binds the matching checklist into this validator's packet. Omitted, the domain is DERIVED from the task's write scope (code-quality always applies; ui-design/system-design follow file extension and path signals) — the first applicable domain nobody has an open validation against yet. A task can carry several open validations at once, one per applicable domain; it reaches validated only once every one of them has passed. |

```bash
bun harness.ts task:validate-start --run .olt/capsules/<run-id> --task task-1 --validator val-1
bun harness.ts task:validate-start --run .olt/capsules/<run-id> --task task-1 --validator val-1 --validator-domain code-quality
```

### `task:review`

Record a validator verdict with its gate evidence.

--status pass finalises the task and unblocks dependants; --status fail records a defect finding and returns the task for repair. A failing verdict must carry --summary, --severity and --remediation: they are the validator's own finding and the harness supplies no wording for them. A pass is refused while the task is short of min_adversarial_probes probes, a mandatory gate's recorded run exited non-zero, or an open finding has no --resolve answering it. Every open finding, probe demand or defect, must be answered explicitly: the harness never marks one answered on the validator's behalf. --checklist-domain plus --checklist-report (B12.5) attach standing-checklist coverage to the report: which items were checked and passed, which were not applicable, which could not be checked, and any standing-standard finding outside this task's own scope. None of it gates this task's verdict; the report states it separately so the coverage is visible rather than implied.

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
| `--summary` | string | no | no | - | Verdict summary; with --status fail this is the defect the validator observed and is required. |
| `--severity` | string | no | no | - | critical, important or minor. Required with --status fail; there is no default severity. |
| `--remediation` | string | no | no | - | What would fix the defect. Required with --status fail; the harness writes no remediation of its own. |
| `--revalidation` | string | no | no | - | How the fix is to be proven. Without it the finding cites the task's own gate. |
| `--evidence` | string | no | no | - | Comma-separated command ids proving the verdict. |
| `--checks` | string | no | no | - | Alias of --evidence. |
| `--finding-id` | string | no | no | - | Explicit finding id for a failing verdict. |
| `--requirement` | string | no | no | - | Requirement a failing verdict binds its finding to. |
| `--resolve` | string | no | yes | - | Answer an open finding: <finding-id>=<command-id>[,<command-id>]. |
| `--resolution-method` | string | no | yes | - | How a finding was answered: <finding-id>=<method>; defaults to the finding's class. |
| `--checklist-domain` | string | no | no | - | B12.5: the standing checklist (code-quality, product, security, system-design, ui-design) this review reports coverage against. Requires --checklist-report; every item in that domain's checklist must be accounted for. |
| `--checklist-report` | string | no | no | - | Path to a JSON file: {"items":[{"id":"<checklist-id>","disposition":"checked|not_applicable|could_not_check","reason":"<required unless checked>"}, ...],"adjacent_findings":[{"id","checklist_item_id","severity","observation","remediation","evidence":[...]}]}. Requires --checklist-domain. |
| `--require-semantic-depth` | bool | no | no | - | Enforce strict semantic depth audits on companion manifest criteria and cognitive questions. |
| `--kind` | string | no | no | - | Review channel kind: cognitive or adversarial. |
| `--micro-cycle` | bool | no | no | - | Record micro-cycle feedback within active lease. |
| `--in-lease` | bool | no | no | - | Alias of --micro-cycle. |
| `--defect` | string | no | no | - | Identified defect category or description for micro-cycle. |
| `--max-rounds` | int | no | no | - | Maximum micro-cycle rounds allowed before formal rejection. |

```bash
bun harness.ts task:review --run .olt/capsules/<run-id> --task task-1 --validator val-1 --token <token> --status pass --checks C-123 --summary "All gates pass"
bun harness.ts task:review --run .olt/capsules/<run-id> --task task-1 --validator val-1 --token <token> --status pass --checks C-123 --resolve probe-task-1-01-1=C-123
bun harness.ts task:review --run .olt/capsules/<run-id> --task task-1 --validator val-1 --token <token> --status fail --summary "Gate command never ran against the new schema" --severity critical --remediation "Point the gate at tests/db and rerun it"
bun harness.ts task:review --run .olt/capsules/<run-id> --task task-1 --validator val-1 --token <token> --status pass --checks C-123 --summary "All gates pass" --checklist-domain code-quality --checklist-report coverage.json
```
