# CLI Capability Manifest — mind (lifecycle)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

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
| `--capsules-dir` | string | no | no | - | Override .olt/capsules/ directory location. |

```bash
bun harness.ts mind:init --repo . --charter olt/agents/mind.yaml --actor owner
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
bun harness.ts mind:wake --run .olt/capsules/mind-gen-1
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
bun harness.ts mind:observe --run .olt/capsules/mind-gen-1 --actor mind-1 --source intent-drift --command-id cmd-41 --count 0
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
bun harness.ts mind:quiesce --run .olt/capsules/mind-gen-1 --actor mind-1 --source intent-drift:cmd-1:0 --source unassigned-todos:cmd-2:0
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
bun harness.ts mind:escalate --run .olt/capsules/mind-gen-1 --actor mind-1 --reason "budget exhausted unexpectedly"
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
bun harness.ts mind:halt --run .olt/capsules/mind-gen-1 --actor mind-1 --reason "critical safety check failure"
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
bun harness.ts mind:rotate --run .olt/capsules/mind-gen-1 --next-run .olt/capsules/mind-gen-2 --actor coordinator-1
```

### `factory:preplan`

Execute continuous pre-planning factory tick to cluster backlog and emit blueprints.

Scans .olt/backlog.jsonl and .olt/defects.jsonl, groups eligible items into thematic domain clusters, writes Phase 1 master plan blueprints, and updates bridge states under flock protection.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--repo` | string | no | no | - | Repository root path. |
| `--root` | string | no | no | - | Alias for --repo. |
| `--dry-run` | bool | no | no | - | Simulate clustering and blueprint generation without disk mutations. |

```bash
bun harness.ts factory:preplan
bun harness.ts factory:preplan --dry-run
bun harness.ts factory:preplan --repo .
```

### `factory:status`

Inspect factory pre-planning queue health, stagnation status, and concurrency saturation.

Audits the pre-planning backlog queue against stagnation thresholds, evaluates skill concurrency saturation, and reports readiness for blueprint assembly.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--repo` | string | no | no | - | Repository root path. |
| `--root` | string | no | no | - | Alias for --repo. |

```bash
bun harness.ts factory:status
bun harness.ts factory:status --repo .
```
