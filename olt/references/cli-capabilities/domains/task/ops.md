# CLI Capability Manifest — task (ops)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

### `task:brief`

Generate a zero-exploration 1-shot briefing for a task.

Produces a structured briefing containing assigned write scope, target files, gate commands, recommended file-scoped test commands, acceptance criteria, and next actions.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--task` | string | no | no | - | Task id to brief. |
| `--agent` | string | no | no | - | Agent id assigned to or briefing for the task. |
| `--role` | string | no | no | - | Role under which the task is being briefed. |

```bash
bun harness.ts task:brief --run .olt/capsules/<run-id> --task task-1
```

### `task:probe`

Record the mandatory adversarial probe: a demand for proof, not a rejection.

Each --demand becomes a probe_demand finding on the task.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--task` | string | yes | no | - | Task under validation. |
| `--validator` | string | yes | no | - | Validator agent id. |
| `--token` | string | yes | no | - | Validation token. |
| `--demand` | string | no | yes | - | What the implementation must prove; repeat per demand. |
| `--requirement` | string | no | no | - | Requirement the demands bind to. |
| `--revalidation` | string | no | no | - | How each demand is to be answered. |
| `--evidence` | string | no | no | - | Comma-separated command ids the demands cite. |

```bash
bun harness.ts task:probe --run .olt/capsules/<run-id> --task task-1 --validator val-1 --token <token> --demand "Prove parser rejects empty payload"
```

### `task:reject`

Reject a task with a structured finding for targeted repair.

Records the validator's finding and returns the task to the implementer.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--task` | string | yes | no | - | Task under validation. |
| `--validator` | string | yes | no | - | Validator agent id. |
| `--token` | string | no | no | - | Validation token. |
| `--reason` | string | yes | no | - | What is defective. |
| `--severity` | string | no | no | - | critical, important or minor. |
| `--remediation` | string | no | no | - | What would fix the defect. |
| `--finding` | string | no | no | - | Alias of --remediation. |
| `--finding-id` | string | no | no | - | Explicit finding id. |
| `--evidence` | string | no | no | - | Comma-separated command ids proving the defect. |
| `--checks` | string | no | no | - | Alias of --evidence. |
| `--requirement` | string | no | no | - | Requirement the finding binds to. |
| `--micro-cycle` | bool | no | no | - | Record micro-cycle feedback within active lease. |
| `--in-lease` | bool | no | no | - | Alias of --micro-cycle. |
| `--defect` | string | no | no | - | Identified defect category or description. |
| `--max-rounds` | int | no | no | - | Maximum micro-cycle rounds allowed. |

```bash
bun harness.ts task:reject --run .olt/capsules/<run-id> --task task-1 --validator val-1 --token <token> --reason "Missing validation" --severity critical
```

### `task:check`

Incremental verification.

Check the files using AST lint audit and TypeScript typecheck pass.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | no | no | - | Capsule run root. |
| `--task` | string | no | no | - | Task ID. |
| `--file` | string | no | yes | - | File path. |
| `--actor` | string | no | no | - | Who is running the check. |
| `--typecheck` | bool | no | no | - | Force the typecheck pass to run. |
| `--lint` | bool | no | no | - | Run only the AST lint audit. |

```bash
bun harness.ts task:check --file src/index.ts
```

### `task:add`

Enqueue a task in the task queue.

Appends a new task item into the task queue with dependency graph validation.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--task` | string | no | no | - | Task ID. |
| `--task-id` | string | no | no | - | Alias for task ID. |
| `--title` | string | no | no | - | Task title. |
| `--description` | string | no | no | - | Task description. |
| `--priority` | string | no | no | - | Task priority (CRITICAL, HIGH, MEDIUM, LOW). |
| `--gate` | string | no | no | - | Gate verification command. |
| `--write-scope` | string | no | yes | - | Assigned writable file path. |
| `--charter-goals` | string | no | yes | - | Charter goal identifiers. |
| `--acceptance-criteria` | string | no | yes | - | Acceptance criteria items. |
| `--dependencies` | string | no | yes | - | Task dependency IDs. |
| `--source-type` | string | no | no | - | Task source type. |
| `--status` | string | no | no | - | Initial task status. |
| `--assigned-tier` | string | no | no | - | Assigned execution tier. |
| `--assigned-role` | string | no | no | - | Assigned agent role. |
| `--max-retries` | int | no | no | - | Maximum retry count. |
| `--queue-path` | string | no | no | - | Custom task queue file path. |
| `--path` | string | no | no | - | Alias for queue-path. |

```bash
bun harness.ts task:add --task task-1 --title "Implement auth" --gate "bun test"
```

### `task:list`

List tasks in the task queue.

Queries and lists queue items with filtering and queue statistics.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--status` | string | no | no | - | Filter tasks by status. |
| `--priority` | string | no | no | - | Filter tasks by priority. |
| `--agent-id` | string | no | no | - | Filter tasks by assigned agent ID. |
| `--search` | string | no | no | - | Filter tasks by substring in ID or title. |
| `--limit` | int | no | no | - | Maximum number of tasks to return. |
| `--queue-path` | string | no | no | - | Custom task queue file path. |
| `--path` | string | no | no | - | Alias for queue-path. |
| `--stats` | bool | no | no | - | Include queue statistics in output. |

```bash
bun harness.ts task:list --status PENDING
```

### `coordinator:pushback`

Reject a validator's own recorded pass, procedurally or substantively.

QUEUE-6: the edge every pushback ran on was validator -> implementer; this is the missing coordinator -> validator edge, for when the validator's OWN recorded pass does not hold up. The task must currently be `validated` (every applicable domain passed, not yet finished) and must carry a recorded pass from --validator in --domain, or this refuses. `--cause procedural` means the review act itself did not meet the evidentiary bar (no evidence recorded, a required check skipped) — the implementer's work is not in question, so the task returns only to `validating` for a fresh, properly-evidenced review. `--cause substantive` means the work itself is judged wrong despite the recorded pass — that carries the same consequence a validator's own reject does: repair_round advances, the original implementer is reassigned, and the task goes to `changes_requested` (or `escalated` once repair rounds are exhausted). The disputed pass is archived into validation_history, never silently dropped, and every pushback is recorded on the task under `coordinator_pushbacks` with its cause, so a rejection for 'you did not record what you did' is expressible and auditable, not just implied by a status change.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--task` | string | yes | no | - | Task carrying the standing pass being contested. |
| `--actor` | string | yes | no | - | Coordinator agent id recorded as the author of this pushback. |
| `--validator` | string | yes | no | - | Validator whose recorded pass is being pushed back on. |
| `--domain` | string | yes | no | - | Validator domain the disputed pass covers, e.g. ui-design. |
| `--cause` | string | yes | no | - | 'procedural' (the review was not properly evidenced) or 'substantive' (the work itself is wrong). |
| `--observation` | string | yes | no | - | What the coordinator found wrong with the pass. |
| `--remediation` | string | yes | no | - | What must happen before this can pass again. |

```bash
bun harness.ts coordinator:pushback --run .olt/capsules/<run-id> --task task-1 --actor coordinator --validator val-1 --domain ui-design --cause procedural --observation "pass carried zero screenshot evidence" --remediation "re-run the visual suite and record real evidence before passing again"
bun harness.ts coordinator:pushback --run .olt/capsules/<run-id> --task task-1 --actor coordinator --validator val-1 --domain code-quality --cause substantive --observation "the recorded check output shows the gate never ran" --remediation "fix the gate invocation and resubmit"
```
