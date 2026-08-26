# CLI Capability Manifest — task

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).

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

### `task:claim`

Lease a specific ready task under a declared role.

Transitions the task to leased and returns the bearer token the agent must echo back. --role is the capability contract the agent is bound to for the whole lease, so the caller names it: implementer for fresh work, repairer for a task returned by a validator.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--task` | string | yes | no | - | Task id to claim. |
| `--agent` | string | yes | no | - | Agent id receiving the lease. |
| `--role` | string | yes | no | - | Role contract the agent claims under: implementer for a ready task, repairer for one in changes_requested. |
| `--lease-duration` | int | no | no | - | Lease length in seconds (5-86400). |
| `--lease-seconds` | int | no | no | `1200` | Alias of --lease-duration. |

```bash
bun harness.ts task:claim --run .olt/capsules/<run-id> --task task-1 --agent worker-1 --role implementer
bun harness.ts task:claim --run .olt/capsules/<run-id> --task task-1 --agent worker-1 --role repairer
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

### `task:submit`

Submit completed task work for validation.

Records the submission report, audits write-scope compliance, and moves the task to submitted. --summary is mandatory unless --report supplies the whole report; nothing is substituted for it. files_changed comes from --files-changed when given, otherwise from the Git working-tree observation narrowed to the write scope; checks come from --evidence when given, otherwise from the agent's recorded commands. The command fails when neither source yields anything. C4: a content digest of the write scope is compared against the one task:claim recorded; a submission whose scope is byte-identical to its content at claim is refused unless --no-op --reason states why nothing needed to change — an unexplained no-change submission is an error, never inferred as intentional.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--task` | string | yes | no | - | Leased task id. |
| `--agent` | string | yes | no | - | Agent holding the lease. |
| `--token` | string | yes | no | - | Lease bearer token. |
| `--summary` | string | no | no | - | What the agent changed. Required unless --report carries the summary. |
| `--evidence` | string | no | yes | - | Recorded command id proving the work. |
| `--files-changed` | string | no | yes | - | Repository-relative path the agent changed. |
| `--report` | string | no | no | - | Path to a complete submission report payload. |
| `--no-op` | bool | no | no | - | Declares the write scope legitimately needed no change. Requires --reason; refused if the scope actually changed since claim. |
| `--reason` | string | no | no | - | Why --no-op is true. Required with --no-op, and meaningless without it. |

```bash
bun harness.ts task:submit --run .olt/capsules/<run-id> --task task-1 --agent worker-1 --token <token> --summary "Implemented user auth"
bun harness.ts task:submit --run .olt/capsules/<run-id> --task task-1 --agent worker-1 --token <token> --summary "Investigated; no code change was needed" --no-op --reason "task-0 already fixed the same defect"
```

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

### `task:assign-repairer`

Replace the original implementer as a task's repairer, with a recorded reason.

The original implementer always gets the first repair opportunity; this records the harness's own decision to hand the repair lease to someone else instead. --reason stale requires the prior repair attempt's lease to have gone stale; --reason repeated_failure requires at least two recorded repair rounds; --reason unavailable carries no precondition beyond the task already awaiting its original repairer.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--task` | string | yes | no | - | Task in changes_requested, awaiting its original repairer. |
| `--actor` | string | yes | no | - | Who is recording the reassignment. |
| `--repairer` | string | yes | no | - | Replacement agent id; must differ from the original. |
| `--reason` | string | yes | no | - | repeated_failure, stale, or unavailable; each carries its own precondition. |
| `--evidence` | string | yes | no | - | Why the replacement is warranted. |

```bash
bun harness.ts task:assign-repairer --run .olt/capsules/<run-id> --task task-1 --actor coordinator --repairer worker-2 --reason unavailable --evidence "worker-1 released without claiming the repair lease"
```

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
