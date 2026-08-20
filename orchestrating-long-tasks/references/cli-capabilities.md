# CLI Capability Manifest

Generated from `orchestrating-long-tasks/scripts/src/cli/registry` by `scripts/generate-cli-manifest.ts`. Do not edit by hand.

Every command runs as `bun orchestrating-long-tasks/scripts/harness.ts <command> [--flag value]`.
Output is a markdown brief of at most 30 lines; `--format json` returns the structured result instead.
`bun harness.ts help` lists the commands and `bun harness.ts help <command>` prints this detail for one of them.

## Exit codes

| Code | Meaning |
| :--- | :--- |
| `0` | SUCCESS - markdown brief on stdout, or JSON when --format json is set |
| `3` | INVALID_ARGUMENT / INVALID_STATE / INTEGRITY / PATH_SAFETY / UNSUPPORTED_PLATFORM - rejected before the capsule changed |
| `4` | LOCK_TIMEOUT - the capsule lock was still held at the deadline |
| `70` | NOT_IMPLEMENTED, or an unexpected failure the harness did not classify |

`run:exec` is the one exception: it exits 0 whenever the child ran at all, and reports the child's
own status in `exit_code`.

## plan

### `orchestrate`

The primary entry point: the user's entire prompt in, a running orchestration out.

Takes the user's whole message as free text and captures it byte-for-byte as the immutable prompt (identical guarantee to plan:init), then opens the capsule. No flags to learn: everything typed after `orchestrate` is the prompt, and a piped stdin with no flags at all is read automatically (detected the way `cat`/`grep` do it, by checking whether stdin is actually a pipe, never by blocking an interactive terminal). --prompt-stdin and --prompt-file still work exactly as before, for a caller that wants to be explicit or that also needs --repo/--run alongside a real file or pipe. A registered flag such as --repo or --run typed AFTER the inline free text is refused rather than folded into the prompt, so it can never silently lose its effect or pollute the captured bytes — use --prompt-file or piped stdin instead of mixing flags into inline text. Returns the fixed checklist for what happens next — plan:enhance, plan:add, plan:compile, queue:wave — bound to the run it just opened, so the calling agent never has to assemble that sequence by hand. It cannot run plan:enhance itself: reading the repository and deciding what the run is actually about needs a model's judgment, and the harness never calls one. --run is optional; omitted, a run id is derived from today's date and the first few words of the prompt.

- **Aliases**: none
- **Stdin**: reads stdin when `--prompt-stdin` is set
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--repo` | string | no | no | `.` | Repository root that owns the capsule. |
| `--run` | string | no | no | - | Run id; interchangeable with --run-id. Derived from the prompt when omitted. |
| `--run-id` | string | no | no | - | Run id; interchangeable with --run. Derived from the prompt when omitted. |
| `--prompt-file` | string | no | no | - | File holding the verbatim prompt bytes. |
| `--prompt-stdin` | bool | no | no | - | Read the verbatim prompt bytes from stdin explicitly. Not required for a real pipe: a bare `orchestrate` with nothing else after it already reads stdin when it is not an interactive terminal. This flag exists for a caller that wants the read to fail loudly instead of silently falling through when stdin turns out not to be piped. |
| `--capture-mode` | string | no | no | - | How the prompt was captured; defaults to argv, file or stdin, whichever was actually used. |
| `--source-verified` | bool | no | no | - | Assert the prompt source was verified by the caller. |
| `--runtime-source` | string | no | no | - | Directory to pin as this run's runtime, verified and copied into runtime/. Defaults to the directory containing the currently running harness.ts. |
| `--no-runtime-pin` | bool | no | no | - | Skip pinning a runtime even when one is available by default. |

```bash
bun harness.ts orchestrate Add a slugify helper that lowercases text and collapses punctuation.
printf "%s" "$PROMPT" | bun harness.ts orchestrate
bun harness.ts orchestrate --repo . --run my-feature --prompt-file prompt.txt
```

### `plan:init`

Create a run capsule and capture the prompt bytes immutably.

Initialises <repo>/.capsules/<run-id>, records the verbatim prompt with its sha256, and ensures the capsule is gitignored.

- **Aliases**: `init`
- **Stdin**: reads stdin when `--prompt-stdin` is set
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | no | no | - | Run id; interchangeable with --run-id. |
| `--run-id` | string | no | no | - | Run id; interchangeable with --run. |
| `--repo` | string | no | no | `.` | Repository root that owns the capsule. |
| `--prompt-file` | string | no | no | - | File holding the verbatim prompt bytes. |
| `--prompt-stdin` | bool | no | no | - | Read the verbatim prompt bytes from stdin. |
| `--capture-mode` | string | no | no | - | How the prompt was captured; defaults to the source used. |
| `--source-verified` | bool | no | no | - | Assert the prompt source was verified by the caller. |
| `--runtime-source` | string | no | no | - | Directory to pin as this run's runtime, verified and copied into runtime/. Defaults to the directory containing the currently running harness.ts. |
| `--no-runtime-pin` | bool | no | no | - | Skip pinning a runtime even when one is available by default. |

```bash
printf "%s" "$PROMPT" | bun harness.ts plan:init --repo . --run <run-id> --prompt-stdin
bun harness.ts plan:init --repo . --run-id <run-id> --prompt-file prompt.txt --capture-mode file
```

### `plan:enhance`

Record the agent's reading of the repository as a reviewable plan document.

Writes planning/enhanced-plan.md and planning/enhanced-plan.json read-only and records their digests in state.planning.enhanced_plan. The agent reads the repository host-side and reports what it found; the harness asks no model anything and invents no entry, so everything recorded carries evidence_class agent_reported. The document is derived: prompt.md stays the requirement source. Needs at least one of --summary, --observation, --todo, --risk or --open-question.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--actor` | string | yes | no | - | Actor recorded on the event. |
| `--summary` | string | no | no | - | The enhanced brief: what this run is actually about. |
| `--observation` | string | no | yes | - | Something the agent found in the repository. |
| `--todo` | string | no | yes | - | One organised to-do item, in the order to do it. |
| `--risk` | string | no | yes | - | A risk the agent identified. |
| `--open-question` | string | no | yes | - | A question the agent could not answer. |
| `--source` | string | no | yes | - | A file the agent actually read. |

```bash
bun harness.ts plan:enhance --run .capsules/<run-id> --actor planner --summary "Wire the drawer to the graph store" --todo "Add the state machine tab" --todo "Delete the legacy asset writes" --risk "Fixture dataset predates the new schema" --source src/graph/store.ts
```

### `plan:add`

Register a task declaration in the planning buffer.

Appends one task to the uncompiled planning buffer. Rejected once the plan has been compiled.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--id` | string | yes | no | - | Task id, unique within the buffer. |
| `--label` | string | yes | no | - | Human label for the task. |
| `--scope` | string | yes | no | - | Comma-separated write scope paths. |
| `--gate` | string | yes | no | - | Verification command that proves the task. |
| `--actor` | string | yes | no | - | Actor recorded on the event. |
| `--deps` | string | no | no | - | Comma-separated ids this task depends on. |
| `--goal` | string | no | no | - | Goal statement for the task. |
| `--criteria` | string | no | no | - | Semicolon-separated acceptance criteria. |
| `--priority` | int | no | no | - | Scheduling priority; higher runs earlier. |
| `--effort` | int | no | no | - | Relative effort estimate. |
| `--requirement-lines` | string | no | no | - | Prompt lines this task implements, e.g. "3-5,8". Without it the compiler glues the task to a prompt line by position and warns. |

```bash
bun harness.ts plan:add --run .capsules/<run-id> --id task-1 --label "Database schema" --scope "src/db" --gate "bun test tests/db.test.ts" --actor coordinator
bun harness.ts plan:add --run .capsules/<run-id> --id task-2 --label "CLI wiring" --scope "src/cli" --gate "bun test tests/unit/cli" --actor coordinator --requirement-lines "3-5"
```

### `plan:compile`

Compile the planning buffer into requirements, the DAG, and revision 1.

Checks scope independence, derives requirements from the prompt lines, builds the graph, and commits graph revision 1. The mandatory run-completion gate is whatever --completion-gate declares; the compiler has no default for it and refuses to invent one.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--actor` | string | yes | no | - | Actor recorded on the event. |
| `--completion-gate` | string | yes | no | - | Command the whole run is finally held to, e.g. "bun test tests/unit". Recorded as the mandatory run-scope gate; there is no default. |
| `--strict-parallel` | bool | no | no | - | Treat serialization advisories as failures. |

```bash
bun harness.ts plan:compile --run .capsules/<run-id> --actor planner --completion-gate "bun test tests/unit"
```

### `plan:replan`

Partition findings into a repair wave and raise the graph revision.

Ingests validator or critic findings, partitions them into disjoint write scopes, and compiles the next revision.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--actor` | string | yes | no | - | Actor recorded on the event. |
| `--findings` | string | no | no | - | Inline JSON findings payload. |
| `--findings-file` | string | no | no | - | Path to a JSON findings payload. |
| `--round` | int | no | no | - | Explicit repair round number. |
| `--gate` | string | no | no | - | Revalidation gate for generated repair tasks. Omit only when the findings declare revalidation_gate or the planned task covering the scope has a gate to inherit; there is no default. |

```bash
bun harness.ts plan:replan --run .capsules/<run-id> --actor coordinator --gate "bun run typecheck"
```

### `plan:claim`

Issue a planner's role packet: the sole way a planner agent gets its contract.

The planner has no task and no lease, so it cannot task:claim. This is its equivalent: it hands back the planner role contract, the immutable prompt, and the write scope (planning/requirements.json, planning/graph.json) the planner is bound to fill in before plan:apply.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--agent` | string | yes | no | - | The planner's own agent id, already agent:register'd. |

```bash
bun harness.ts plan:claim --run .capsules/<run-id> --agent planner-1
```

### `plan:apply`

Validate and commit the requirements and graph the planner wrote to planning/.

Reads requirements.json and graph.json (defaulting to planning/ inside the run), validates them against the immutable prompt, and commits them as the next graph revision. --expected-revision rejects the apply outright if the graph has moved since the planner's packet was issued, instead of silently overwriting a newer plan.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--actor` | string | yes | no | - | Actor recorded on the event. |
| `--requirements` | string | no | no | - | Path to the requirements document. Defaults to <run>/planning/requirements.json. |
| `--graph` | string | no | no | - | Path to the graph document. Defaults to <run>/planning/graph.json. |
| `--expected-revision` | int | no | no | - | The graph revision this apply must be built against; the apply is refused if the run has moved past it. |

```bash
bun harness.ts plan:apply --run .capsules/<run-id> --actor planner-1 --expected-revision 0
```

### `plan:status`

Show the planning buffer or the compiled plan summary.

Reports every buffered task with its scope, gate and dependencies.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |

```bash
bun harness.ts plan:status --run .capsules/<run-id>
```

## queue

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
bun harness.ts queue:next --run .capsules/<run-id>
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
bun harness.ts queue:list --run .capsules/<run-id>
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
bun harness.ts queue:wave --run .capsules/<run-id> --max-parallel 4
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
bun harness.ts queue:pop --run .capsules/<run-id> --agent worker-1 --lease-seconds 1800
```

## task

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
bun harness.ts task:claim --run .capsules/<run-id> --task task-1 --agent worker-1 --role implementer
bun harness.ts task:claim --run .capsules/<run-id> --task task-1 --agent worker-1 --role repairer
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
| `--extend` | int | no | no | `1800` | Extension in seconds (60-86400). |

```bash
bun harness.ts task:heartbeat --run .capsules/<run-id> --task task-1 --agent worker-1 --token <token>
```

### `task:submit`

Submit completed task work for validation.

Records the submission report, audits write-scope compliance, and moves the task to submitted. --summary is mandatory unless --report supplies the whole report; nothing is substituted for it. files_changed comes from --files-changed when given, otherwise from the Git working-tree observation narrowed to the write scope; checks come from --evidence when given, otherwise from the agent's recorded commands. The command fails when neither source yields anything.

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

```bash
bun harness.ts task:submit --run .capsules/<run-id> --task task-1 --agent worker-1 --token <token> --summary "Implemented user auth"
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
bun harness.ts task:validate-start --run .capsules/<run-id> --task task-1 --validator val-1
bun harness.ts task:validate-start --run .capsules/<run-id> --task task-1 --validator val-1 --validator-domain code-quality
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

```bash
bun harness.ts task:review --run .capsules/<run-id> --task task-1 --validator val-1 --token <token> --status pass --checks C-123 --summary "All gates pass"
bun harness.ts task:review --run .capsules/<run-id> --task task-1 --validator val-1 --token <token> --status pass --checks C-123 --resolve probe-task-1-01-1=C-123
bun harness.ts task:review --run .capsules/<run-id> --task task-1 --validator val-1 --token <token> --status fail --summary "Gate command never ran against the new schema" --severity critical --remediation "Point the gate at tests/db and rerun it"
bun harness.ts task:review --run .capsules/<run-id> --task task-1 --validator val-1 --token <token> --status pass --checks C-123 --summary "All gates pass" --checklist-domain code-quality --checklist-report coverage.json
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
bun harness.ts task:probe --run .capsules/<run-id> --task task-1 --validator val-1 --token <token> --demand "Prove the parser rejects an empty payload"
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
| `--token` | string | yes | no | - | Validation token. |
| `--reason` | string | yes | no | - | What is defective. |
| `--severity` | string | yes | no | - | critical, important or minor. |
| `--remediation` | string | no | no | - | What would fix the defect. Required unless --finding carries it. |
| `--finding` | string | no | no | - | Alias of --remediation. |
| `--finding-id` | string | no | no | - | Explicit finding id. |
| `--evidence` | string | no | no | - | Comma-separated command ids proving the defect. |
| `--checks` | string | no | no | - | Alias of --evidence. |
| `--requirement` | string | no | no | - | Requirement the finding binds to. |

```bash
bun harness.ts task:reject --run .capsules/<run-id> --task task-1 --validator val-1 --token <token> --reason "Missing input validation" --severity critical --remediation "Validate the payload before the insert"
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
bun harness.ts task:assign-repairer --run .capsules/<run-id> --task task-1 --actor coordinator --repairer worker-2 --reason unavailable --evidence "worker-1 released without claiming the repair lease"
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
bun harness.ts task:release --run .capsules/<run-id> --task task-1 --agent worker-1 --token <token>
```

## run

### `run:exec`

Run a gate command under process isolation and record the evidence.

Captures argv, cwd, timestamps, exit code and log bytes into the capsule, then ingests any screenshots, visual report and browser run metadata the command produced.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: forwarded to the child process

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--task` | string | no | no | - | Task the command belongs to. |
| `--gate` | string | no | no | - | Gate id the command proves. |
| `--cwd` | string | no | no | - | Working directory; falls back to the repository root. |
| `--actor` | string | yes | no | - | Who is running the command. Recorded on the command and its event; there is no default actor. |
| `--tool-category` | string | no | no | - | Generic category of the tool, e.g. browser-automation, build, database, documentation, file-edit, formatter, http-client, linter, package-manager, search, shell, test-runner, type-checker, version-control. Any other value is recorded as given. |
| `--tool` | string | no | no | - | The tool this command invoked, named as you name it. |
| `--tool-extra` | string | no | yes | - | One tool-specific fact about this command as <key>=<value>, kept verbatim under the reported name. |

```bash
bun harness.ts run:exec --run .capsules/<run-id> --task task-1 --gate gate-1 --actor val-1 --tool-category test-runner --tool bun-test -- bun test tests/unit/auth.test.ts
```

### `run:status`

Show phase, per-task status and progress for the run.

Reads the capsule without mutating it and renders the execution table.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--detailed` | bool | no | no | - | Include the raw state in the JSON result. |

```bash
bun harness.ts run:status --run .capsules/<run-id>
```

### `run:complete`

Seal the capsule after verifying every completion artifact.

Re-verifies the recorded command evidence and the live repository binding, then commits terminal completion and regenerates the summary suite.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--actor` | string | yes | no | - | Who is completing the run. Recorded on the completion event; there is no default actor. |
| `--auth-token` | string | yes | no | - | The token critic:review handed back on approval; verified against the completeness critic's own record before the run can be sealed. |

```bash
bun harness.ts run:complete --run .capsules/<run-id> --actor coordinator --auth-token <token-from-critic:review>
```

## critic

### `critic:start`

Authorise a completeness critic against the immutable prompt bytes.

Records a repository inspection, assigns the critic, and returns the critic token required to review.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--critic` | string | yes | no | - | Critic agent id. |
| `--repository-command-ids` | string | no | yes | - | Extra authoritative command ids to add as repository evidence, alongside every run-gate command the harness auto-discovers. |

```bash
bun harness.ts critic:start --run .capsules/<run-id> --critic critic-1
```

### `critic:review`

Record the completeness verdict over the whole repository diff.

--decision approve clears completion; request_changes records findings that block it and requires --findings or --findings-file, because the harness never composes a finding on the critic's behalf. Every finding must carry id, requirement_id, severity, observation, remediation and revalidation. Requirement proofs come only from --proofs/--proofs-file or --review; a requirement with no proof is recorded unproven and blocks completion, and a clean verdict with any unproven requirement is refused. integrity_evidence is always the harness's own capsule integrity observation, measured at review time; a --review file cannot certify its own capsule, so whatever it declares under that key is replaced.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--critic` | string | yes | no | - | Critic agent id. |
| `--token` | string | yes | no | - | Critic token. |
| `--decision` | string | yes | no | - | approve or request_changes. |
| `--summary` | string | yes | no | - | Verdict summary in the critic's own words. |
| `--findings` | string | no | no | - | Inline JSON findings payload. |
| `--findings-file` | string | no | no | - | Path to a JSON findings payload. |
| `--proofs` | string | no | no | - | Inline JSON requirement_proofs payload. |
| `--proofs-file` | string | no | no | - | Path to a JSON requirement_proofs payload. |
| `--review` | string | no | no | - | Path to a complete review payload. |

```bash
bun harness.ts critic:review --run .capsules/<run-id> --critic critic-1 --token <token> --decision approve --proofs-file proofs.json --summary "Whole diff verified"
```

### `critic:reject`

Reject completion with findings that trigger replanning.

Equivalent to critic:review --decision request_changes with a rejection brief. Structured findings are mandatory: pass --findings or --findings-file.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--critic` | string | yes | no | - | Critic agent id. |
| `--token` | string | yes | no | - | Critic token. |
| `--summary` | string | yes | no | - | Rejection summary in the critic's own words. |
| `--findings` | string | no | no | - | Inline JSON findings payload. |
| `--findings-file` | string | no | no | - | Path to a JSON findings payload. |
| `--proofs` | string | no | no | - | Inline JSON requirement_proofs payload. |
| `--proofs-file` | string | no | no | - | Path to a JSON requirement_proofs payload. |
| `--review` | string | no | no | - | Path to a complete review payload. |

```bash
bun harness.ts critic:reject --run .capsules/<run-id> --critic critic-1 --token <token> --summary "Missing error boundary" --findings '[{"id":"F-01","requirement_id":"req-1","severity":"critical","observation":"No error boundary around the render tree","remediation":"Wrap the tree in an error boundary","revalidation":"bun test tests/render"}]'
```

### `critic:remediate`

Close out a critic findings review with command-backed remediation evidence.

Every review recorded with status findings stays in history and blocks completion until it carries a remediation naming exactly its own finding ids, each proven by a critic-run, task-unbound, successful command. --resolve is repeatable as <finding-id>=<command-id>[,<command-id>]; --resolution-method names how each finding was closed. --review-sha256 defaults to the currently recorded review.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--actor` | string | yes | no | - | Who is recording the remediation. |
| `--review-sha256` | string | no | no | - | Digest of the review being remediated. |
| `--resolve` | string | no | yes | - | Answer a finding: <finding-id>=<command-id>[,<command-id>]. |
| `--resolution-method` | string | no | yes | - | How a finding was answered: <finding-id>=<method>. |

```bash
bun harness.ts critic:remediate --run .capsules/<run-id> --actor coordinator --resolve CF-1=C-fix-1 --resolution-method CF-1="focused repair and verification"
```

## summary

### `summary:export`

Write the graph, timeline, metrics and executive brief to disk.

Generates the summary suite under <run>/summary and, with --out, an additional registry export for the graph viewer.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--out` | string | no | no | - | Directory for the viewer registry export. |

```bash
bun harness.ts summary:export --run .capsules/<run-id>
```

### `summary:view`

Render the executive brief without writing anything.

Generates the same suite in memory and returns only the markdown brief.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |

```bash
bun harness.ts summary:view --run .capsules/<run-id>
```

## inspection

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
bun harness.ts finding:get --run .capsules/<run-id> --id finding-task-1
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
bun harness.ts report:get --run .capsules/<run-id> --task task-1 --type review
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
bun harness.ts evidence:get --run .capsules/<run-id> --task task-1
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
bun harness.ts evidence:screenshots --run .capsules/<run-id> --task task-1
```

## orchestrator

### `orchestrator:run`

Run the autonomous coordination loop over a fresh capsule.

Drives plan, execute, validate and critic rounds until the critic approves or the round budget is spent. The host must inject a round executor; without one the command fails with INVALID_STATE.

- **Aliases**: `orchestrator`
- **Stdin**: reads stdin when `--prompt-stdin` is set
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--repo` | string | no | no | - | Repository root; falls back to the current directory. |
| `--prompt` | string | no | no | - | Inline prompt text. |
| `--prompt-file` | string | no | no | - | File holding the prompt. |
| `--prompt-stdin` | bool | no | no | - | Read the prompt from stdin. |
| `--run-id` | string | no | no | - | Base run id for the generated capsules. |
| `--run` | string | no | no | - | Alias of --run-id. |
| `--capsules-dir` | string | no | no | - | Directory that holds the capsules. |
| `--max-rounds` | int | no | no | `10` | Round budget, clamped to 1-10. |
| `--actor` | string | no | no | - | Actor recorded on the loop summary; omitted leaves the loop unattributed. |

```bash
bun harness.ts orchestrator:run --repo . --prompt "Implement the feature" --max-rounds 3
```

### `orchestrator:supervise`

Reclaim dead agents, escalate dead-end tasks, and dispatch what's ready (B28).

One reclaim-classify-dispatch pass over a run's eligible set: reclaims leases whose agent died without submitting, escalates tasks whose failures have become deterministic (B28.3) instead of retrying them forever, and reports what is safe to dispatch now versus still backing off. With a host-injected dispatcher it loops until the run reaches a terminal state; without one it performs a single pass, which is what makes it safe to drive from an external poll loop. Recovery is on by default (B28.5) - use --no-recover to disable it.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--actor` | string | yes | no | - | Who is running the supervisor. Recorded on every event; there is no default actor. |
| `--max-parallel` | int | no | no | - | Occupancy ceiling; falls back to the run's configured default. |
| `--gate-max-parallel` | int | no | no | - | B27.2: the separate, lower ceiling for gate-running (CPU-bound) work, reported alongside --max-parallel; falls back to the run's configured default (derived from host cores). |
| `--no-recover` | bool | no | no | - | Disable automatic dead-agent reclaim and escalation (on by default). |
| `--grace-seconds` | int | no | no | - | Grace period past lease expiry before reclaiming, 0-86400. |
| `--poll-interval-ms` | int | no | no | - | How often to re-tick while a dispatcher is driving the loop. |
| `--max-elapsed-ms` | int | no | no | - | Per-task retry budget before a transient failure reads as deterministic (B28.3). |
| `--max-total-elapsed-ms` | int | no | no | - | Whole-run wall-clock budget before the supervisor stops and reports. |
| `--deterministic-repeat-threshold` | int | no | no | - | Consecutive identical failures before they read as deterministic. |

```bash
bun harness.ts orchestrator:supervise --run .capsules/<run-id> --actor coordinator
```

## branch

### `branch:open`

Subdivide the work you hold into sub-tasks a sub-agent can take.

A branch is an execution-time subdivision, never a plan task, so it never touches the plan revision. The parent moves to `branched` and its lease clock freezes until collect or abandon, which is what stops a parent blocked on children from being reaped as stale. Every sub-task scope must be a STRICTLY PROPER subset of the parent scope and stay disjoint from its siblings; a violation is refused, not trimmed. That proper-subset rule is what makes a chain of branches terminate. --parent-task accepts a plan task or another branch's sub-task; config max_branch_depth (default 5) is an escalation tripwire on nesting rather than a structural bound, and config max_agents (default 100) caps the grants a run may issue at any depth — a branch is charged one grant per sub-task up front.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--parent-task` | string | yes | no | - | Plan task or sub-task the branch hangs off. |
| `--agent` | string | yes | no | - | Agent holding the parent lease. |
| `--token` | string | yes | no | - | Parent lease bearer token. |
| `--reason` | string | yes | no | - | Why the work had to be subdivided. |
| `--sub-task` | string | no | yes | - | Sub-task id; repeat the flag for each sub-task. |
| `--sub-label` | string | no | yes | - | `<sub-task-id>=<label>`; one per sub-task. |
| `--sub-scope` | string | no | yes | - | `<sub-task-id>=<path>`; repeat for each path. |
| `--sub-gate` | string | no | yes | - | `<sub-task-id>=<command>`; optional revalidation gate. |
| `--repo` | string | no | no | - | Repository root observed through Git; falls back to the current directory. |
| `--actor` | string | no | no | - | Event actor; defaults to the acting agent. |

```bash
bun harness.ts branch:open --run .capsules/<run-id> --parent-task task-1 --agent worker-1 --token <token> --reason "parser rewrite blocks the API change" --sub-task S-1 --sub-label S-1="Fix the parser" --sub-scope S-1=src/one/parser
```

### `branch:claim`

Lease one branch sub-task to a sub-agent.

Returns the bearer token the sub-agent echoes back to branch:submit. The lease expires like any other, and `recover` reclaims it if the sub-agent dies.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--branch` | string | yes | no | - | Branch id returned by branch:open. |
| `--sub-task` | string | yes | no | - | Sub-task id to claim. |
| `--agent` | string | yes | no | - | Sub-agent receiving the lease. |
| `--role` | string | yes | no | - | Branch role the sub-agent works under: sub-implementer, sub-investigator or sub-validator. |
| `--lease-seconds` | int | no | no | - | Lease length in seconds (5-86400). |
| `--repo` | string | no | no | - | Repository root observed through Git; falls back to the current directory. |
| `--actor` | string | no | no | - | Event actor; defaults to the acting agent. |

```bash
bun harness.ts branch:claim --run .capsules/<run-id> --branch B-<uuid> --sub-task S-1 --agent sub-1 --role sub-implementer
```

### `branch:submit`

Hand a finished sub-task back to the branch.

Records what the sub-agent reports it did and releases the sub-lease. The summary is agent-reported; the file-level truth is measured once, by branch:collect.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--branch` | string | yes | no | - | Branch id returned by branch:open. |
| `--sub-task` | string | yes | no | - | Sub-task id being submitted. |
| `--agent` | string | yes | no | - | Sub-agent holding the sub-lease. |
| `--token` | string | yes | no | - | Sub-lease bearer token. |
| `--summary` | string | yes | no | - | What the sub-agent changed. |
| `--actor` | string | no | no | - | Event actor; defaults to the acting agent. |

```bash
bun harness.ts branch:submit --run .capsules/<run-id> --branch B-<uuid> --sub-task S-1 --agent sub-1 --token <token> --summary "Parser accepts the new grammar"
```

### `branch:collect`

Take the branch back and resume the parent.

Refuses while any sub-task is still live. Records a real Git observation of the worktree delta across the branch window as harness_observed evidence, restores the parent lease with a fresh expiry and returns the parent to `running`. When the repository cannot be observed the file list stays absent rather than becoming an empty one.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--branch` | string | yes | no | - | Branch id returned by branch:open. |
| `--agent` | string | yes | no | - | Parent agent that opened the branch. |
| `--token` | string | yes | no | - | Parent lease bearer token. |
| `--summary` | string | yes | no | - | What came back from the sub-agents. |
| `--repo` | string | no | no | - | Repository root observed through Git; falls back to the current directory. |
| `--actor` | string | no | no | - | Event actor; defaults to the acting agent. |

```bash
bun harness.ts branch:collect --run .capsules/<run-id> --branch B-<uuid> --agent worker-1 --token <token> --summary "Parser fixed; API change unblocked"
```

### `branch:abandon`

Give up on a branch and resume the parent.

The failure path. Every non-terminal sub-task is marked abandoned and its lease released, then the parent gets its lease back and returns to `running` to carry the work itself.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--branch` | string | yes | no | - | Branch id returned by branch:open. |
| `--agent` | string | yes | no | - | Parent agent that opened the branch. |
| `--token` | string | yes | no | - | Parent lease bearer token. |
| `--reason` | string | yes | no | - | Why the branch is being given up. |
| `--actor` | string | no | no | - | Event actor; defaults to the acting agent. |

```bash
bun harness.ts branch:abandon --run .capsules/<run-id> --branch B-<uuid> --agent worker-1 --token <token> --reason "sub-agent could not reproduce the failure"
```

### `branch:status`

Show which branches are open and what they are waiting on.

Lists open branches by default with the reason each one was opened. --all includes collected and abandoned ones, --branch narrows to one and --task narrows to a parent.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--branch` | string | no | no | - | Show only this branch. |
| `--task` | string | no | no | - | Show only branches under this parent. |
| `--all` | bool | no | no | - | Include collected and abandoned branches. |

```bash
bun harness.ts branch:status --run .capsules/<run-id>
bun harness.ts branch:status --run .capsules/<run-id> --task task-1 --all
```

## agent

### `agent:register`

Record a dispatched subagent and mint its grant.

Spawning happens host-side; this is how the run learns a subagent exists, who deployed it and under which task. Model, tier, thinking level and toolset below are whatever the dispatcher relays — recorded only when supplied, tagged agent_reported, and left absent otherwise. The harness separately probes the host's own config and transcript for the same fields automatically; only that probe ever earns host_reported/derived/harness_observed. The parent agent must already hold a grant.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--agent` | string | yes | no | - | Agent id of the dispatched subagent. |
| `--role` | string | yes | no | - | Canonical role the agent is granted. |
| `--host` | string | yes | no | - | Host runtime that spawned the agent. |
| `--parent-agent` | string | no | no | - | Agent id that dispatched it; omit for the root. |
| `--parent-task` | string | no | no | - | Task or branch sub-task the agent is dispatched onto. |
| `--actor` | string | no | no | - | Event actor; defaults to the parent agent, else the agent. |
| `--provider` | string | no | no | - | Provider serving the model, as the caller relays it (agent_reported). |
| `--model` | string | no | no | - | Model id as the caller relays it, recorded exactly as given and never parsed (agent_reported). |
| `--model-tier` | string | no | no | - | Tier as the caller relays it: xs, s, m, l or unknown (agent_reported unless unknown). |
| `--thinking-level` | string | no | no | - | Level as the caller relays it: low, medium, high or unknown (agent_reported unless unknown). |
| `--context-window` | int | no | no | - | Context window in tokens, as the caller relays it (agent_reported). |
| `--tool` | string | no | yes | - | One tool as <name> or <name>=<category>; repeat the flag for each tool. Generic category of the tool, e.g. browser-automation, build, database, documentation, file-edit, formatter, http-client, linter, package-manager, search, shell, test-runner, type-checker, version-control. Any other value is recorded as given. A tool given without a category has none recorded. |
| `--tool-extra` | string | no | yes | - | One tool-specific fact as <tool>:<key>=<value>, kept verbatim under the reported name. The tool must also be given with --tool. |

```bash
bun harness.ts agent:register --run .capsules/<run-id> --agent worker-1 --role implementer --host claude-code --parent-agent coordinator-1 --parent-task task-1 --tool Bash=shell --tool-extra Bash:shell=zsh
```

### `agent:report`

Ingest the caller's own report of tool usage and token counts mid-flight.

Token counts are the caller's running totals and replace the previous ones, tagged agent_reported; --tokens-estimated marks them derived estimates instead. The harness separately probes the host's own transcript for real counts (B34), which is what actually earns harness_observed. At least one of --tool, --tokens-in, --tokens-out or --token-extra is required.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--agent` | string | yes | no | - | Agent id holding the grant. |
| `--tool` | string | no | yes | - | One tool as <name> or <name>=<category>; repeat the flag for each tool. Generic category of the tool, e.g. browser-automation, build, database, documentation, file-edit, formatter, http-client, linter, package-manager, search, shell, test-runner, type-checker, version-control. Any other value is recorded as given. A tool given without a category has none recorded. |
| `--tool-extra` | string | no | yes | - | One tool-specific fact as <tool>:<key>=<value>, kept verbatim under the reported name. The tool must also be given with --tool. |
| `--tokens-in` | int | no | no | - | Input tokens consumed so far, as the caller reports it. |
| `--tokens-out` | int | no | no | - | Output tokens produced so far, as the caller reports it. |
| `--token-extra` | string | no | yes | - | One provider-specific counter as <name>=<count>, kept under the name the caller reported it by. |
| `--tokens-estimated` | bool | no | no | - | Record the counts as estimates, not measurements. |
| `--actor` | string | no | no | - | Event actor; defaults to the reporting agent. |

```bash
bun harness.ts agent:report --run .capsules/<run-id> --agent worker-1 --tool Read=file-edit --tool Grep=search --tokens-in 18000 --tokens-out 2400 --token-extra cache_read_input_tokens=91000
```

### `agent:release`

Close a subagent's grant.

Marks the grant released and stamps the release time. A released agent can no longer report.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--agent` | string | yes | no | - | Agent id holding the grant. |
| `--reason` | string | no | no | - | Why the grant closed. |
| `--actor` | string | no | no | - | Event actor; defaults to the released agent. |

```bash
bun harness.ts agent:release --run .capsules/<run-id> --agent worker-1 --reason "task-1 submitted"
```

### `agent:list`

Show who is deployed, or the lineage of one task.

Without flags it lists active grants with whatever telemetry was recorded, each field labelled with the evidence class it actually earned. --task answers who worked a task and under whom, including the agents those agents dispatched.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--task` | string | no | no | - | Report the lineage of this task instead of the roster. |
| `--all` | bool | no | no | - | Include released grants. |

```bash
bun harness.ts agent:list --run .capsules/<run-id>
bun harness.ts agent:list --run .capsules/<run-id> --task task-1
```

## orphan

### `orphan:dispose`

Close out a command record that arrived without a live owner.

Orphan evidence — typically a durable command record left behind by an agent that died mid-run — blocks completion until it is explicitly dispositioned. --disposition is ignored_non_authoritative, rejected, or superseded; there is no default, and each disposition is terminal.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--actor` | string | yes | no | - | Who is recording the disposition. |
| `--orphan-sha256` | string | yes | no | - | Digest of the orphan evidence, from doctor's issues. |
| `--disposition` | string | yes | no | - | ignored_non_authoritative, rejected, or superseded. |
| `--rationale` | string | yes | no | - | Why this disposition is correct. |
| `--evidence` | string | no | yes | - | Command id supporting the disposition; repeat per id. |

```bash
bun harness.ts orphan:dispose --run .capsules/<run-id> --actor coordinator --orphan-sha256 <sha> --disposition ignored_non_authoritative --rationale "agent worker-3 died before submitting; the command it ran is not authoritative for any task" --evidence C-abc123
```

## authority

### `authority:decide`

Grant or decline a needs_authority requirement.

A requirement disposed needs_authority holds every task built on it non-executable until this is recorded. Granting makes it actionable; declining disposes it out_of_scope and cancels every dormant task that depends on it alone, refusing instead if that would invalidate an active or completed one. The decision is permanent: a second call with the same actor and rationale is idempotent, any other call against an already-decided requirement is refused.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--requirement` | string | yes | no | - | Requirement id, currently disposed needs_authority. |
| `--actor` | string | yes | no | - | Who is making the decision. |
| `--decision` | string | yes | no | - | grant or decline. |
| `--rationale` | string | yes | no | - | Why this decision is correct. |

```bash
bun harness.ts authority:decide --run .capsules/<run-id> --requirement req-prod-deploy --actor coordinator --decision grant --rationale "Human approved the production deploy in the review thread"
```

## install

### `install`

Install the skill release and link it into the requested clients.

Copies the validated source tree to <home>/.agents/skills and publishes a symlink per client, rolling the whole transaction back on failure.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--source` | string | yes | no | - | Skill source directory to install. |
| `--home` | string | yes | no | - | Home directory that receives the release. |
| `--clients` | string | yes | no | - | Comma-separated clients: antigravity, claude, codex, chatgpt. |

```bash
bun harness.ts install --source . --home ~ --clients claude,antigravity
```

### `installation-status`

Audit the installed release, its digest and its client links.

Compares the installed tree digest against the source, then checks every client symlink target.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--source` | string | yes | no | - | Skill source directory to compare against. |
| `--home` | string | yes | no | - | Home directory holding the release. |
| `--clients` | string | no | no | - | Comma-separated clients; defaults to the installed manifest. |

```bash
bun harness.ts installation-status --source . --home ~
```

## diagnostics

### `health`

Check whether the code still does what the requirements said.

Reports unused exports and unreachable modules, dead or superseded code, declared behaviour nothing enforces, requirements with no code or no test, literal fallbacks that substitute a plausible value for a missing one, and vendor names in identifier positions. Every check prints what it cannot see. Unlike `doctor` it reads a source tree, not a capsule.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--scripts` | string | no | no | - | Harness scripts root to inspect. Defaults to the running harness. |
| `--consumer` | string | no | no | - | Consumer repository root. Without it the vendor-name sweep covers one repo, and says so. |
| `--check` | string | no | yes | - | Restrict the run to named checks. |
| `--all` | bool | no | no | - | List every failure instead of the first five per check, and every advisory alongside them. |
| `--strict` | bool | no | no | - | Exit nonzero when the report is unhealthy. |

```bash
bun harness.ts health
bun harness.ts health --consumer ../gvui --all
bun harness.ts health --check unused-code --strict
```

### `doctor`

Verify capsule integrity, command evidence and the runtime.

Re-hashes the event chain, re-verifies every recorded command, reports workflow blockers and, with --source and --home, the installation state.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--source` | string | no | no | - | Skill source directory for the installation check. |
| `--home` | string | no | no | - | Home directory for the installation check. |
| `--clients` | string | no | no | - | Comma-separated clients for the installation check. |

```bash
bun harness.ts doctor --run .capsules/<run-id>
```

### `doctor:repair`

Re-derive state.json from the event chain after a crash tears the log's tail.

The repair counterpart to `doctor`: `doctor` only reports a torn tail or a state/event mismatch. This re-derives state.json from the event chain's last complete event, quarantining any torn final fragment under quarantine/ instead of discarding it, and records a projection-recovered event. Refuses if the manifest or prompt itself is corrupt - that is an integrity failure, not something to repair silently.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--actor` | string | yes | no | - | Who is running the repair. Recorded on the event; there is no default actor. |

```bash
bun harness.ts doctor:repair --run .capsules/<run-id> --actor coordinator
```

### `recover`

Release expired leases and interrupted validations.

Returns tasks whose lease expired to retry_ready (or changes_requested after a repair attempt), reopens interrupted validations, reclaims branch sub-tasks whose sub-agent died, and expires a stale completeness critic. A branched parent's frozen lease is never reaped: it is blocked on children, not gone.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--actor` | string | yes | no | - | Who is running the recovery. Recorded on the event; there is no default actor. |
| `--grace-seconds` | int | no | no | `30` | Grace period past expiry, 0-86400. |

```bash
bun harness.ts recover --run .capsules/<run-id> --actor coordinator
```
