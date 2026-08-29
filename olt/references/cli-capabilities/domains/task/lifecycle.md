# CLI Capability Manifest — task (lifecycle)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

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
