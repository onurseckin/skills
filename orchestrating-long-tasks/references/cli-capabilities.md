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

Appends one task to the uncompiled planning buffer. Rejected once the plan has been compiled. --scope and --gate are required for a single task declaration; omit both and pass --auto-partition instead to have the harness enumerate a glob on disk and register one task per match (or per --group-by directory) in one call, each with its own gate derived from --gate-template. Every declared --deps id needs a matching --dep-reason before plan:compile will seal the plan (C6's mandatory edge justification).

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--id` | string | yes | no | - | Task id, unique within the buffer. In --auto-partition mode this is the id prefix every generated task id is built from. |
| `--label` | string | yes | no | - | Human label for the task. In --auto-partition mode this is the label prefix for every generated task. |
| `--scope` | string | no | no | - | Comma-separated write scope paths. Required unless --auto-partition is set; refused together with it. |
| `--gate` | string | no | no | - | Verification command that proves the task. Required unless --auto-partition is set; refused together with it. |
| `--actor` | string | yes | no | - | Actor recorded on the event. |
| `--deps` | string | no | no | - | Comma-separated ids this task depends on. Refused together with --auto-partition. |
| `--dep-reason` | string | no | yes | - | One dependency's justification as "<dep-id>:<why this edge exists>". plan:compile refuses to seal while any --deps id lacks a matching --dep-reason. Refused together with --auto-partition. |
| `--goal` | string | no | no | - | Goal statement for the task. |
| `--criteria` | string | no | no | - | Semicolon-separated acceptance criteria. |
| `--priority` | int | no | no | - | Scheduling priority; higher runs earlier. |
| `--effort` | int | no | no | - | Relative effort estimate. |
| `--requirement-lines` | string | no | no | - | Prompt lines this task implements, e.g. "3-5,8". Without it the compiler glues the task to a prompt line by position and warns. |
| `--auto-partition` | string | no | no | - | A glob the harness enumerates on disk (relative to the repository root); emits one task per matched file, or per --group-by directory. Mutually exclusive with --scope, --gate, --deps and --dep-reason. |
| `--gate-template` | string | no | no | - | Command template for --auto-partition; must contain the literal placeholder {scope}, substituted per generated task with that task's own file or directory path. Required together with --auto-partition. |
| `--group-by` | string | no | no | `file` | file (default) or directory: whether --auto-partition emits one task per matched file or one task per directory holding matches. |

```bash
bun harness.ts plan:add --run .capsules/<run-id> --id task-1 --label "Database schema" --scope "src/db" --gate "bun test tests/db.test.ts" --actor coordinator
bun harness.ts plan:add --run .capsules/<run-id> --id task-2 --label "CLI wiring" --scope "src/cli" --gate "bun test tests/unit/cli" --actor coordinator --requirement-lines "3-5"
bun harness.ts plan:add --run .capsules/<run-id> --id task-3 --label "Integration" --scope "src/integration" --gate "bun test tests/integration" --actor coordinator --deps task-1,task-2 --dep-reason "task-1:reads the schema task-1 writes" --dep-reason "task-2:reads the CLI wiring task-2 writes"
bun harness.ts plan:add --run .capsules/<run-id> --id task-topic --label "Topic bank" --actor coordinator --auto-partition "src/curriculum/mlQuestions/*.ts" --gate-template "bun test {scope}"
```

### `plan:audit`

Audit the planning buffer against the six topology invariants and record the verdict.

Runs A1-granularity, A3-gate-discrimination, A4-false-barrier, A5-straggler and A6-whole-suite-gate against the current planning buffer and records the verdict as a plan-audited event, whatever the outcome. A2-parallelism has no grounded entity count to compare against anywhere in this plan and is reported under not_evaluated rather than guessed. plan:compile runs the same audit and refuses to seal the plan on any blocking finding whose invariant was not accepted with --accept-audit; this command lets a coordinator see the verdict before attempting a compile.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--actor` | string | yes | no | - | Actor recorded on the event. |

```bash
bun harness.ts plan:audit --run .capsules/<run-id> --actor planner
```

### `plan:compile`

Compile the planning buffer into requirements, the DAG, and revision 1.

Checks scope independence, derives requirements from the prompt lines, builds the graph, and commits graph revision 1. The mandatory run-completion gate is whatever --completion-gate declares; the compiler has no default for it and refuses to invent one. Also refuses to seal while any dependency edge in the buffer lacks the one-line justification `plan:add --dep-reason` records for it (C6's topology declaration) — the independent-root count and every justified edge are reported on the brief. Before any of that, runs plan:audit's six invariants and refuses to seal on any blocking finding: pass --accept-audit "<invariant-id>:<reason>" once per blocking invariant to record an explicit, attributed override and proceed anyway. There is no blanket override — every blocking invariant needs its own acceptance naming who accepted it and why.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--actor` | string | yes | no | - | Actor recorded on the event. |
| `--completion-gate` | string | yes | no | - | Command the whole run is finally held to, e.g. "bun test tests/unit". Recorded as the mandatory run-scope gate; there is no default. |
| `--accept-audit` | string | no | yes | - | Accept one blocking plan:audit invariant so compilation may proceed: "<invariant-id>:<reason>". Repeatable; every blocking invariant needs its own acceptance, and an invariant the audit did not raise as blocking is refused rather than silently accepted. Never a blanket override. |

```bash
bun harness.ts plan:compile --run .capsules/<run-id> --actor planner --completion-gate "bun test tests/unit"
bun harness.ts plan:compile --run .capsules/<run-id> --actor planner --completion-gate "bun test tests/unit" --accept-audit "A3-gate-discrimination:task-a and task-b legitimately share the shared-fixture regression test"
```

### `plan:validate-start`

Assign the plan-validator and mint the token required by plan:review.

C2: opens the plan-validator's claim on the currently compiled plan (the projected tasks, requirements and gates at this graph revision, delivered via the packet) — one active assignment per graph revision, mirroring task:validate-start. The validator must be independent from the coordinator or planner that produced the plan. Dispatch this, and get a passing plan:review, before dispatching any implementer: a recorded plan:review --status changes_requested against the live graph revision is a hard stop that claimTask enforces directly, not a warning a coordinator can route around.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--validator` | string | yes | no | - | Plan-validator agent id. |
| `--lease-duration` | int | no | no | `1200` | Seconds until the validation window expires (5-86400). |

```bash
bun harness.ts plan:validate-start --run .capsules/<run-id> --validator plan-val-1
```

### `plan:review`

Record the plan-validator's written verdict on the compiled plan.

C2: --status approved clears the plan for implementer dispatch; changes_requested is the pushback — it records structured findings (each with id, severity, observation, remediation) and blocks every implementer and repairer claim against this graph revision until a fresh compile passes a new review. The four questions (--decomposition-answer, --dependency-answer, --gate-answer, --straggler-answer) are mandatory on every verdict, pass or reject: a rubber-stamped pass that never answered them is refused. Beyond prose, the verdict carries a mechanical floor: --dependency-edges-reviewed must name every dependency edge the compiled plan actually declares (exactly, not a subset) and --gate-ids-reviewed must name every per-task gate id in the plan (never the run-scoped completion gate, which is not a task gate) — omit a real one, or name one that does not exist, and the review is refused before it is recorded. changes_requested requires --findings or --findings-file; approved must carry none.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--validator` | string | yes | no | - | Plan-validator agent id. |
| `--token` | string | yes | no | - | Plan validation token. |
| `--status` | string | yes | no | - | approved or changes_requested. |
| `--summary` | string | yes | no | - | Verdict summary in the validator's own words. |
| `--decomposition-answer` | string | yes | no | - | Does the decomposition match the work's entity count, or did it compress? |
| `--dependency-answer` | string | yes | no | - | Is every dependency edge justified by a real read/write relationship? |
| `--gate-answer` | string | yes | no | - | Can each gate actually fail if its task does nothing? |
| `--straggler-answer` | string | yes | no | - | Will any task's scope make one agent straggle while the rest idle? |
| `--findings` | string | no | no | - | Inline JSON findings payload (array of {id, severity, observation, remediation}). |
| `--findings-file` | string | no | no | - | Path to a JSON findings payload. |
| `--checks` | string | no | no | - | Comma-separated command ids the validator ran as independent evidence. |
| `--dependency-edges-reviewed` | string | no | no | - | Comma-separated "<from-task>:<to-task>" pairs — must name exactly the dependency edges the compiled plan declares, no more and no fewer. Empty when the plan declares none. |
| `--gate-ids-reviewed` | string | no | no | - | Comma-separated gate ids — must name exactly the plan's per-task gate ids (never the run-scoped completion gate), no more and no fewer. |

```bash
bun harness.ts plan:review --run .capsules/<run-id> --validator plan-val-1 --token <token> --status approved --decomposition-answer "14 tasks match the 14 named topics" --dependency-answer "no dependency edges; every task is an independent root" --gate-answer "each gate runs only that task's own scoped test file" --straggler-answer "every task carries the same one-topic effort estimate" --gate-ids-reviewed "gate-1,gate-2,gate-3" --summary "Decomposition matches the prompt; gates are scope-narrow"
bun harness.ts plan:review --run .capsules/<run-id> --validator plan-val-1 --token <token> --status changes_requested --decomposition-answer "10 topics compressed into 1 task" --dependency-answer "n/a" --gate-answer "the shared gate cannot fail per-task" --straggler-answer "n/a" --gate-ids-reviewed "gate-1" --summary "Compressed decomposition; see findings" --findings '[{"id":"PV-1","invariant":"A2-parallelism","severity":"critical","observation":"10 distinct topics collapsed into task-domains","remediation":"one task per topic, each with its own scoped gate"}]'
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

The planner has no task and no lease, so it cannot task:claim. This is its equivalent: it hands back the planner role contract, the immutable prompt, and the write scope (planning/requirements.json, planning/graph.json) the planner is bound to fill in before plan:apply. The packet's prescribed plan:apply command is pre-filled with --expected-revision at the run's live graph revision, so it succeeds on a run that has already compiled a graph, not only on a brand-new one.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--agent` | string | yes | no | - | The planner's own agent id, already agent:register'd. |
| `--expected-revision` | int | no | no | - | The graph revision the caller believes is live; the claim is refused if the run has moved past it. Omitted, the packet is issued at whatever revision is actually live. |

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

### `dag:view`

Render live ASCII execution DAG, active subagent allocations, and algorithmic parallelization recommendations.

Inspects compiled graph or planning buffer DAG topology, computes critical path depth, tracks active subagent leases, and generates algorithmic parallelization recommendations.

- **Aliases**: `graph:ascii`, `status:dag`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | no | no | - | Capsule run root. Defaults to current repository .capsules/ when omitted. |
| `--run-id` | string | no | no | - | Alias of --run. |
| `--repo` | string | no | no | `.` | Repository root to search for .capsules/. |
| `--detailed` | bool | no | no | - | Render full write scopes, gate commands, and dependency lists. |
| `--recommendations` | bool | no | no | - | Highlight algorithmic parallelization opportunities. |
| `--all` | bool | no | no | - | Do not truncate output lines. |

```bash
bun harness.ts dag:view --run .capsules/<run-id>
bun harness.ts graph:ascii --run .capsules/<run-id> --detailed
bun harness.ts dag:view --detailed --recommendations
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

```bash
bun harness.ts task:heartbeat --run .capsules/<run-id> --task task-1 --agent worker-1 --token <token>
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
bun harness.ts task:submit --run .capsules/<run-id> --task task-1 --agent worker-1 --token <token> --summary "Implemented user auth"
bun harness.ts task:submit --run .capsules/<run-id> --task task-1 --agent worker-1 --token <token> --summary "Investigated; no code change was needed" --no-op --reason "task-0 already fixed the same defect"
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
| `--require-semantic-depth` | bool | no | no | - | Enforce strict semantic depth audits on companion manifest criteria and cognitive questions. |

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
bun harness.ts task:abandon --run .capsules/<run-id> --task task-1 --actor coordinator --reason "agent-1 crashed mid-attempt and will not return"
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
bun harness.ts coordinator:pushback --run .capsules/<run-id> --task task-1 --actor coordinator --validator val-1 --domain ui-design --cause procedural --observation "pass carried zero screenshot evidence" --remediation "re-run the visual suite and record real evidence before passing again"
bun harness.ts coordinator:pushback --run .capsules/<run-id> --task task-1 --actor coordinator --validator val-1 --domain code-quality --cause substantive --observation "the recorded check output shows the gate never ran" --remediation "fix the gate invocation and resubmit"
```

## reporting

### `report:graph-json`

Export DAG telemetry and metrics to JSON.

Export DAG telemetry and metrics to JSON.

- **Aliases**: `dag:export-json`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | no | no | - | Path to capsule run directory |
| `--run-id` | string | no | no | - | Capsule run identifier |
| `--out` | string | no | no | - | Path to save JSON |
| `--pretty` | bool | no | no | - | Format output JSON nicely |

```bash
bun harness.ts report:graph-json --run .capsules/<run-id> --out graph.json
```

### `report:dag`

Canonical reporting for DAG status.

Aliases/links to dag:view to inspect compiled graph or planning buffer DAG topology.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | no | no | - | Capsule run root. Defaults to current repository .capsules/ when omitted. |
| `--run-id` | string | no | no | - | Alias of --run. |
| `--repo` | string | no | no | `.` | Repository root to search for .capsules/. |
| `--detailed` | bool | no | no | - | Render full write scopes, gate commands, and dependency lists. |
| `--recommendations` | bool | no | no | - | Highlight algorithmic parallelization opportunities. |
| `--all` | bool | no | no | - | Do not truncate output lines. |

```bash
bun harness.ts report:dag --run .capsules/<run-id>
```

### `report:graph`

Visual/ASCII and graph overview.

Renders the task graph.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--detailed` | bool | no | no | - | Detailed output. |

```bash
bun harness.ts report:graph --run .capsules/<run-id>
```

### `report:health`

Canonical reporting for health/doctor status.

Runs the capsule doctor to check health status.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--source` | string | no | no | - | Source. |
| `--home` | string | no | no | - | Home. |
| `--clients` | string | no | no | - | Clients. |

```bash
bun harness.ts report:health --run .capsules/<run-id>
```

### `report:leases`

Active lease and agent matrix.

Reports the matrix of active leases.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |

```bash
bun harness.ts report:leases --run .capsules/<run-id>
```

### `report:decisions`

Inspection of authority decisions and governance audit.

Reports the decisions audit matrix.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |

```bash
bun harness.ts report:decisions --run .capsules/<run-id>
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

One reclaim-classify-dispatch pass over a run's eligible set: reclaims leases whose agent died without submitting, escalates tasks whose failures have become deterministic (B28.3) instead of retrying them forever, and reports what is safe to dispatch now versus still backing off. With a host-injected dispatcher it loops until the run reaches a terminal state; without one it performs a single pass, which is what makes it safe to drive from an external poll loop. Recovery is on by default (B28.5) - use --no-recover to disable it. --watch turns this into the poll loop itself: it re-runs the reclaim/escalate heartbeat every --interval seconds until the run goes terminal or the process gets an explicit stop (Ctrl-C / SIGTERM), surfacing changes_requested tasks awaiting a repairer alongside the escalated ones so a rejected task is never silently invisible.

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
| `--watch` | bool | no | no | - | Run unattended: re-tick the reclaim/escalate heartbeat every --interval seconds until the run is terminal or the process gets an explicit stop (Ctrl-C / SIGTERM). Ignores any host-injected dispatcher - this is the recovery heartbeat, not a dispatch loop. |
| `--interval` | int | no | no | `30` | Seconds between heartbeat ticks in --watch mode; refused without --watch. |

```bash
bun harness.ts orchestrator:supervise --run .capsules/<run-id> --actor coordinator
bun harness.ts orchestrator:supervise --run .capsules/<run-id> --actor coordinator --watch --interval 30
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
| `--reason` | string | yes | no | - | Why the grant closed. |
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

### `whoami`

Inspect thread execution tier, PID, active agent, grants, and main-thread compliance.

Inspects the calling thread's OS process ID, parent PID, execution tier, active agent ID, active role grants, and task leases. When executed on the interactive main thread, enforces the Main-Thread Restraint Guard advisory and logs structured blunder records for unauthorized direct implementations.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | no | no | - | Capsule run root to cross-reference active leases and grants. |
| `--agent` | string | no | no | - | Explicit agent id override to inspect. |
| `--pid` | int | no | no | - | Process ID override for testing. |
| `--ppid` | int | no | no | - | Parent Process ID override for testing. |

```bash
bun harness.ts whoami
bun harness.ts whoami --run .capsules/<run-id> --agent coordinator-lead
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

### `coverage:check`

Audit repository test coverage against strict 95% threshold.

Runs bun test with coverage collection, parses per-file metrics across lines, statements, functions, and branches, and enforces the minimum 95% threshold.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--threshold` | string | no | no | `0.95` | Minimum coverage threshold fraction, default 0.95. |
| `--dir` | string | no | no | - | Target repository directory to run coverage check in. |
| `--strict` | bool | no | no | - | Exit nonzero when coverage is below threshold. |

```bash
bun harness.ts coverage:check
bun harness.ts coverage:check --threshold 0.95 --strict
```

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

### `worktree:reclaim`

Free an abandoned run's worktree directories.

B22.6: removes the worktree directories a crashed or abandoned run left behind, after a human has looked and decided the run is not being resumed. The harness branch and every per-task worktree branch are left untouched — only the disposable worktree checkouts are removed. Refuses if worktree isolation is currently off for this run's config.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--actor` | string | yes | no | - | Who is running the reclaim. Recorded on the event; there is no default actor. |

```bash
bun harness.ts worktree:reclaim --run .capsules/<run-id> --actor coordinator
```

### `explain`

Explain a HarnessError code: the rule it enforces, common causes and the remedy for each.

Answers a refused command with a command instead of a file to read. --code is one of the ErrorCode values a HarnessError actually carries (INTEGRITY, INVALID_ARGUMENT, INVALID_STATE, LOCK_TIMEOUT, NOT_IMPLEMENTED, PATH_SAFETY, UNSUPPORTED_PLATFORM); case-insensitive. Every cause is grounded in real throw sites in this build, cited by file and line, plus a live count of how many places in the current source tree still throw that code. --command narrows further: it dynamically scans that command's own implementation file for direct throws of --code and reports the exact lines and messages, rather than a canned guess about which command hits which cause.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--code` | string | yes | no | - | HarnessError code to explain: INTEGRITY, INVALID_ARGUMENT, INVALID_STATE, LOCK_TIMEOUT, NOT_IMPLEMENTED, PATH_SAFETY, or UNSUPPORTED_PLATFORM. Case-insensitive. |
| `--command` | string | no | no | - | CLI command name (e.g. task:claim) to narrow the explanation to that command's own direct throw sites. |

```bash
bun harness.ts explain --code INTEGRITY
bun harness.ts explain --code INVALID_STATE --command task:claim
```

## gate

### `gate:prove`

Prove a compiled task's gate can actually fail, on a disposable scratch copy.

Copies the repository's tracked and not-ignored files into a throwaway directory, reverts the task's write scope there back to --base (default HEAD), and runs the task's compiled gate against that reverted copy. Falsifiable means the gate exits non-zero once the task's own work is gone — the property this project's own forensics found missing (docs/planning/coordinator-conformance/FORENSICS.md, DESIGN.md's C3): ten tasks sharing one whole-repo `bun run typecheck` gate that passed whether the task did its work or nothing at all. Only runs post-compile, against a task's already-compiled gate and write scope — at plan:compile time the task's work does not exist yet, so reverting it would yield a scratch copy identical to the current tree, and every verdict would degenerate to 'not falsifiable'; gate:prove is a deliberate later step, not something plan:compile runs for you. The verdict is recorded as a gate-proved capsule event via `appendGateProof`, readable back by graph/plan-audit.ts's `auditPlan` through `latestGateProof` when a caller supplies the run's state: A3-gate-discrimination and A6-whole-suite-gate treat a matching falsifiable:true proof as satisfying the invariant instead of refusing on the static heuristic alone. It never touches the real repository, since every read and write happens inside the scratch copy, deleted before this command returns. Exits 0 whether the verdict is falsifiable or not — a negative verdict is real information for the audit to act on, not a gate:prove failure; only a setup problem (no compiled gate for the task, no Git history to revert against, an unreadable repository) throws.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--task` | string | yes | no | - | Compiled task id whose gate is being proved. |
| `--actor` | string | yes | no | - | Actor recorded on the event. |
| `--base` | string | no | no | `the claimed base sha, else HEAD` | Git ref the task's write scope is reverted to before the gate runs. Defaults to the sha task:claim recorded on the task's latest attempt, so the revert lands before that attempt's own commits; falls back to HEAD only when no such sha was recorded. |
| `--timeout-ms` | int | no | no | - | Wall-clock budget for the gate command against the scratch copy; default 300000. |
| `--max-files` | int | no | no | - | Refuses to copy a tree larger than this many tracked/untracked files, so an unexpectedly huge repository fails loudly instead of proving slowly; default 50000. |

```bash
bun harness.ts gate:prove --run .capsules/<run-id> --task task-1 --actor coordinator
bun harness.ts gate:prove --run .capsules/<run-id> --task task-1 --actor coordinator --base HEAD~1
```

## capture

### `capture:init`

Initialize standard capture configuration in repository.

Generates .capture.yaml or .capture.json with standard presets, default viewports, authentication settings, and example screen targets.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--config-dir` | string | no | no | - | Directory to create the configuration file in. |
| `--format` | string | no | no | `yaml` | Configuration format: yaml or json (default: yaml). |
| `--preset` | string | no | no | `standard-dashboard` | Preset template: standard-dashboard, marketing-site, mobile-app, full-matrix. |
| `--force` | bool | no | no | - | Overwrite existing configuration file if present. |

```bash
bun harness.ts capture:init
bun harness.ts capture:init --format json --preset standard-dashboard
```

### `capture:run`

Execute multi-viewport UI capture and companion manifest persistence.

Dispatches Playwright or simulated runner across configured screens and viewports, generating screenshots and 1-to-1 companion manifest JSON records.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | no | no | - | Capsule run root for artifact and screenshot ledger ingestion. |
| `--config` | string | no | no | - | Explicit path to .capture.yaml or .capture.json. |
| `--config-dir` | string | no | no | - | Directory containing capture configuration. |
| `--screen` | string | no | no | - | Filter execution to a specific screen ID. |
| `--viewport` | string | no | no | - | Filter execution to a specific viewport name. |
| `--out-dir` | string | no | no | - | Explicit output directory for captures and manifests. |
| `--actor` | string | no | no | - | Actor recorded in ledger captures (default: capture-runner). |

```bash
bun harness.ts capture:run --config .capture.yaml
bun harness.ts capture:run --run .capsules/<run-id> --screen dashboard --viewport desktop
```

### `capture:eval`

Evaluate companion manifests against 4-pillar validation engines.

Performs strict binary certification across mechanical, cognitive, custom, and synthesis pillars with 0 numeric scores.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--manifest` | string | no | no | - | Path to single .manifest.json companion file. |
| `--manifest-dir` | string | no | no | - | Directory containing .manifest.json companion files. |
| `--strict` | bool | no | no | - | Exit non-zero (exit code 3) if any defects are found. |

```bash
bun harness.ts capture:eval --manifest .captures/dashboard-desktop.manifest.json
bun harness.ts capture:eval --manifest-dir .captures --strict
```

## mind

### `mind:init`

Initialize a mind capsule from an owner charter.

Validates the markdown charter file per CONTRACTS.md §7, creates the mind capsule (mind-gen-<generation>), pins the charter digest into manifest.json, seeds the state projection, and writes the initial last_pulse.json.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--repo` | string | yes | no | - | Repository root the mind serves. |
| `--charter` | string | yes | no | - | Path to the owner's charter file. |
| `--actor` | string | yes | no | - | Recorded on mind-initialized. |
| `--mind-id` | string | no | no | `mind-gen-1` | Mind capsule run id; defaults to mind-gen-1. |
| `--capsules-dir` | string | no | no | - | Override .capsules/ directory location. |

```bash
bun harness.ts mind:init --repo . --charter docs/mind/CHARTER.md --actor owner
```

### `mind:wake`

Produce the Tier A orientation brief and reclaim expired pulses.

Inspects the mind capsule state and budget, reclaims any open pulse past its deadline via mind-pulse-reclaimed, and outputs the Tier A orientation brief ending in prescribed next actions.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | no | no | - | Recorded only if the call reclaims a dead pulse. |
| `--depth` | string | no | no | `brief` | Orientation depth: brief (default) or run. |
| `--target-run` | string | no | no | - | With --depth run, the run capsule whose handoff to render. |

```bash
bun harness.ts mind:wake --run .capsules/mind-gen-1
```

### `mind:pulse-open`

Open an active mind pulse under budget constraints.

Opens a new pulse cycle, validating budget headroom, daily pulse and wall-clock caps, quiet hours, and charter digest consistency before appending mind-pulse-opened.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | yes | no | - | The tier-0 agent id. |
| `--host` | string | yes | no | - | Host runtime as reported. |
| `--driver` | string | yes | no | - | Driver identity as reported. |

```bash
bun harness.ts mind:pulse-open --run .capsules/mind-gen-1 --actor mind-1 --host antigravity --driver bash-loop
```

### `mind:pulse-close`

Close an active mind pulse with an outcome, value score, and next-pulse arm.

Closes the open pulse, calculates value delivered, enforces the arming rail (requiring --arm or --terminal-reason), appends mind-pulse-closed, and updates last_pulse.json.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | yes | no | - | Must match the opening actor. |
| `--pulse` | string | yes | no | - | Pulse id; must match the open pulse. |
| `--outcome` | string | yes | no | - | One of the eleven outcomes in PLAN.md §4.3. |
| `--arm` | string | no | no | - | Duration for the next wake, e.g. 15m. |
| `--arm-mechanism` | string | no | no | - | How it was armed, as reported. |
| `--terminal-reason` | string | no | no | - | Required when --arm is absent and the outcome is not terminal. |
| `--witness` | string | no | no | - | Command id evidencing the work this pulse did. |
| `--signal` | string | no | no | - | Typed signal, e.g. rate_limit; never inferred from prose. |

```bash
bun harness.ts mind:pulse-close --run .capsules/mind-gen-1 --actor mind-1 --pulse pulse-1 --outcome quiescent --arm 15m --arm-mechanism systemd-timer
```

### `mind:observe`

Record a discovery source scan count evidenced by a command record.

Records an observation from one of the ten discovery sources evidenced by a recorded command id, appending mind-observed.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | yes | no | - | Acting agent. |
| `--source` | string | yes | no | - | One of the ten source ids in PLAN.md §7.2. |
| `--command-id` | string | yes | no | - | The recorded command whose output this is. |
| `--count` | int | yes | no | - | How many items that source returned. |

```bash
bun harness.ts mind:observe --run .capsules/mind-gen-1 --actor mind-1 --source intent-drift --command-id cmd-41 --count 0
```

### `mind:candidate`

Record a discovery candidate (defect or proposal).

Proposes a defect or proposal candidate. Defects require a witness command record and falsifier argv. Validates charter goal alignment and write scope before recording mind-candidate-opened.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | yes | no | - | Acting agent. |
| `--kind` | string | yes | no | - | Candidate kind: defect or proposal. |
| `--statement` | string | yes | no | - | One line statement, recorded agent_reported. |
| `--witness` | string | no | no | - | Command id evidencing the defect; required unless --kind proposal. |
| `--charter-goal` | string | yes | yes | - | Goal ids from the pinned charter; repeat for multiple. |
| `--falsifier` | string | no | no | - | Argv that fails now and would pass if fixed (defects only). |
| `--write-scope` | string | yes | yes | - | Paths the work would touch; repeat for multiple. |
| `--rationale` | string | no | no | - | Proposals only. |

```bash
bun harness.ts mind:candidate --run .capsules/mind-gen-1 --actor mind-1 --kind defect --statement "typecheck fails" --witness cmd-123 --charter-goal G1 --falsifier "bun run typecheck" --write-scope orchestrating-long-tasks/scripts/src/health/
```

### `mind:admit`

Run admission gates on a candidate and admit it.

Runs the six admission gates (falsifier verification, scope disjointness, charter alignment, etc.) in order and admits the candidate, appending mind-candidate-admitted.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | yes | no | - | Acting agent. |
| `--candidate` | string | yes | no | - | Candidate id. |

```bash
bun harness.ts mind:admit --run .capsules/mind-gen-1 --actor mind-1 --candidate cand-12
```

### `mind:decline`

Permanently decline a candidate with a recorded reason.

Marks a candidate permanently declined with a recorded reason and gate failure attribution, appending mind-candidate-declined.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | yes | no | - | Acting agent. |
| `--candidate` | string | yes | no | - | Candidate id. |
| `--reason` | string | yes | no | - | Reason why candidate was declined. |

```bash
bun harness.ts mind:decline --run .capsules/mind-gen-1 --actor mind-1 --candidate cand-12 --reason "scope overlaps active lease"
```

### `mind:quiesce`

Record a verified quiescent observation across all ten discovery sources.

Records that all ten discovery sources were scanned and found clean with zero items, appending mind-quiesced.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | yes | no | - | Acting agent. |
| `--source` | string | yes | yes | - | Source scan result as <source>:<command-id>:<count>; repeat for each of the ten sources. |

```bash
bun harness.ts mind:quiesce --run .capsules/mind-gen-1 --actor mind-1 --source intent-drift:cmd-1:0 --source unassigned-todos:cmd-2:0
```

### `mind:escalate`

Record an escalation and append to escalation log.

Records an escalation event in the hash chain and appends the escalation reason to escalation.md.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | yes | no | - | Acting agent. |
| `--reason` | string | yes | no | - | Reason for escalation. |
| `--severity` | string | no | no | - | Severity of escalation. |

```bash
bun harness.ts mind:escalate --run .capsules/mind-gen-1 --actor mind-1 --reason "budget exhausted unexpectedly"
```

### `mind:halt`

Halt mind pulse execution and suppress successor arming.

Halts the mind run, suppresses further autonomous pulse arming, records mind-halted, and updates last_pulse.json with next_wake_at set to null.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | yes | no | - | Acting agent. |
| `--reason` | string | yes | no | - | Reason for halting. |

```bash
bun harness.ts mind:halt --run .capsules/mind-gen-1 --actor mind-1 --reason "critical safety check failure"
```

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
| `--round` | int | yes | no | - | Round index. |
| `--target-run` | string | no | no | - | Chained-from capsule run id. |

```bash
bun harness.ts mind:round-open --run .capsules/mind-gen-1 --actor mind-1 --objective obj-1 --round 1
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
| `--terminal-reason` | string | no | no | - | Reason if round terminates without successor. |
| `--successor-run` | string | no | no | - | Successor capsule run id. |

```bash
bun harness.ts mind:round-close --run .capsules/mind-gen-1 --actor mind-1 --objective obj-1 --round 1 --terminal-reason "objective completed"
```

### `mind:audit-start`

Start an independent audit cycle over recent pulses.

Initiates an independent audit cycle in Phase 5, recording window start time and auditor identity, appending mind-audit-started.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | yes | no | - | Auditor agent id. |
| `--audit-id` | string | yes | no | - | Audit id. |
| `--window-start` | string | yes | no | - | Window start timestamp (ISO8601). |

```bash
bun harness.ts mind:audit-start --run .capsules/mind-gen-1 --actor auditor-1 --audit-id audit-1 --window-start 2026-08-21T00:00:00Z
```

### `mind:audit-report`

Submit findings and verdict for an audit cycle.

Records the eight audit answers with supporting command ids and overall verdict in Phase 5, appending mind-audit-reported.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The mind capsule root. |
| `--actor` | string | yes | no | - | Auditor agent id. |
| `--audit-id` | string | yes | no | - | Audit id. |
| `--verdict` | string | yes | no | - | Audit verdict: approved or failed. |
| `--answer` | string | yes | yes | - | One of eight audit question answers as <question-id>:<command-id>:<verdict>; repeat for all eight. |

```bash
bun harness.ts mind:audit-report --run .capsules/mind-gen-1 --actor auditor-1 --audit-id audit-1 --verdict approved --answer Q1:cmd-10:pass
```

### `mind:rotate`

Rotate generation N capsule into generation N+1.

Performs generational rotation, carrying forward charter pin and declined candidates while preserving auditability.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | The current generation capsule root. |
| `--next-run` | string | yes | no | - | The next generation capsule root. |
| `--actor` | string | yes | no | - | Acting agent id. |

```bash
bun harness.ts mind:rotate --run .capsules/mind-gen-1 --next-run .capsules/mind-gen-2 --actor coordinator-1
```
