# CLI Capability Manifest — plan (validation)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

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
bun harness.ts plan:audit --run .olt/capsules/<run-id> --actor planner
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
bun harness.ts plan:validate-start --run .olt/capsules/<run-id> --validator plan-val-1
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
bun harness.ts plan:review --run .olt/capsules/<run-id> --validator plan-val-1 --token <token> --status approved --decomposition-answer "14 tasks match the 14 named topics" --dependency-answer "no dependency edges; every task is an independent root" --gate-answer "each gate runs only that task's own scoped test file" --straggler-answer "every task carries the same one-topic effort estimate" --gate-ids-reviewed "gate-1,gate-2,gate-3" --summary "Decomposition matches the prompt; gates are scope-narrow"
bun harness.ts plan:review --run .olt/capsules/<run-id> --validator plan-val-1 --token <token> --status changes_requested --decomposition-answer "10 topics compressed into 1 task" --dependency-answer "n/a" --gate-answer "the shared gate cannot fail per-task" --straggler-answer "n/a" --gate-ids-reviewed "gate-1" --summary "Compressed decomposition; see findings" --findings '[{"id":"PV-1","invariant":"A2-parallelism","severity":"critical","observation":"10 distinct topics collapsed into task-domains","remediation":"one task per topic, each with its own scoped gate"}]'
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
bun harness.ts plan:replan --run .olt/capsules/<run-id> --actor coordinator --gate "bun run typecheck"
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
bun harness.ts plan:claim --run .olt/capsules/<run-id> --agent planner-1
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
bun harness.ts plan:apply --run .olt/capsules/<run-id> --actor planner-1 --expected-revision 0
```
