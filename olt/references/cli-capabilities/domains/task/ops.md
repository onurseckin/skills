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
bun harness.ts task:brief --run .olt/capsules/<run-id> --task task-1 --agent worker-1 --role implementer
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
bun harness.ts task:heartbeat --run .olt/capsules/<run-id> --task task-1 --agent worker-1 --token <token>
```

### `task:probe`

Record the mandatory adversarial probe: a demand for proof, not a rejection.

Each --demand becomes a probe_demand finding on the task. The task stays in validating under the same validator, repair_round is untouched, and task:review --status pass stays blocked until min_adversarial_probes rounds are recorded and every demand is answered with command evidence.

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
bun harness.ts task:probe --run .olt/capsules/<run-id> --task task-1 --validator val-1 --token <token> --demand "Prove the parser rejects an empty payload"
```

### `task:reject`

Reject a task with a structured finding for targeted repair.

Records the validator's finding and returns the task to the implementer. The severity and the remediation are the validator's own judgement, so both are demanded; nothing is graded or worded on its behalf.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--task` | string | yes | no | - | Task under validation. |
| `--validator` | string | yes | no | - | Validator agent id. |
| `--token` | string | no | no | - | Validation token. Required for formal rejection. |
| `--reason` | string | yes | no | - | What is defective. |
| `--severity` | string | no | no | - | critical, important or minor. Required for formal rejection. |
| `--remediation` | string | no | no | - | What would fix the defect. Required unless --finding carries it. |
| `--finding` | string | no | no | - | Alias of --remediation. |
| `--finding-id` | string | no | no | - | Explicit finding id. |
| `--evidence` | string | no | no | - | Comma-separated command ids proving the defect. |
| `--checks` | string | no | no | - | Alias of --evidence. |
| `--requirement` | string | no | no | - | Requirement the finding binds to. |
| `--micro-cycle` | bool | no | no | - | Record micro-cycle feedback within active lease. |
| `--in-lease` | bool | no | no | - | Alias of --micro-cycle. |
| `--defect` | string | no | no | - | Identified defect category or description for micro-cycle. |
| `--max-rounds` | int | no | no | - | Maximum micro-cycle rounds allowed before formal rejection. |

```bash
bun harness.ts task:reject --run .olt/capsules/<run-id> --task task-1 --validator val-1 --token <token> --reason "Missing input validation" --severity critical --remediation "Validate the payload before the insert"
```

### `task:check`

Incremental verification.

Check the files. The AST lint audit (0 `any`, 0 compiler suppressions) always runs and can never be skipped; the TypeScript typecheck pass also runs by default alongside it. --lint narrows the run to the AST audit alone, skipping typecheck. --typecheck only matters combined with --lint: it cancels that narrowing so typecheck runs anyway; passed alone it has no effect, since typecheck already runs by default. Exits non-zero when either check reports a violation.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | no | no | - | Capsule run root. |
| `--task` | string | no | no | - | Task ID. |
| `--file` | string | no | yes | - | File path. |
| `--actor` | string | no | no | - | Who is running the check; recorded on the evidence receipt. Omit to use the caller's auto-derived identity — never pass a placeholder or another role's name. |
| `--typecheck` | bool | no | no | - | Force the typecheck pass to run even when --lint is also given. No effect without --lint, since typecheck already runs by default. |
| `--lint` | bool | no | no | - | Run only the AST lint audit, skipping the typecheck pass that runs by default. Combine with --typecheck to cancel this narrowing. |

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
