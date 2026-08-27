# CLI Capability Manifest — reporting

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).

### `report`

Deliver unified topology, lifecycle tier breakdown, agent roles, IDs, and timestamps.

Generates comprehensive unified run report across tasks, topology, agent lifecycle tiers, and audit trail.

- **Aliases**: `report:all`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | no | no | - | Capsule run root. Defaults to current repository .olt/capsules/ when omitted. |
| `--run-id` | string | no | no | - | Alias of --run. |
| `--repo` | string | no | no | `.` | Repository root to search for .olt/capsules/. |
| `--detailed` | bool | no | no | - | Detailed topology and audit forensics. |
| `--json` | bool | no | no | - | Output structured JSON report. |

```bash
bun harness.ts report --run .olt/capsules/<run-id>
bun harness.ts report:unified --run .olt/capsules/<run-id>
```

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
bun harness.ts report:graph-json --run .olt/capsules/<run-id> --out graph.json
```

### `report:dag`

Canonical reporting for DAG status.

Thin wrapper around the same renderer as `dag` (aliased dag:render/dag:view), kept discoverable under the report: namespace. Prefer `dag` directly: it accepts the full flag set (--recommendations, --box-style, --json) this wrapper does not expose.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | no | no | - | Capsule run root. Defaults to current repository .olt/capsules/ when omitted. |
| `--run-id` | string | no | no | - | Alias of --run. |
| `--repo` | string | no | no | `.` | Repository root to search for .olt/capsules/. |
| `--detailed` | bool | no | no | - | Render full write scopes, gate commands, and dependency lists. |
| `--recommendations` | bool | no | no | - | Highlight algorithmic parallelization opportunities. |
| `--all` | bool | no | no | - | Do not truncate output lines. |

```bash
bun harness.ts report:dag --run .olt/capsules/<run-id>
```

### `report:graph`

Visual/ASCII and graph overview.

Another thin wrapper around the same renderer as `dag` (same as report:dag), kept discoverable under the report: namespace. Prefer `dag` directly: it accepts the full flag set (--recommendations, --box-style, --json) this wrapper does not expose.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--detailed` | bool | no | no | - | Detailed output. |

```bash
bun harness.ts report:graph --run .olt/capsules/<run-id>
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
bun harness.ts report:health --run .olt/capsules/<run-id>
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
bun harness.ts report:leases --run .olt/capsules/<run-id>
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
bun harness.ts report:decisions --run .olt/capsules/<run-id>
```

### `report:summary`

Render executive summary brief of capsule run.

Renders the executive brief in markdown or JSON directly to terminal.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--out` | string | no | no | - | Directory for viewer registry export. |
| `--json` | bool | no | no | - | Output JSON. |

```bash
bun harness.ts report:summary --run .olt/capsules/<run-id>
```

### `report:task`

Read and render a task submission, review or critic report.

Extracts and formats full task report evidence including verification outcomes, gate executions, and screenshot records without requiring raw file inspection.

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
bun harness.ts report:task --run .olt/capsules/<run-id> --task task-1
bun harness.ts report:task --run .olt/capsules/<run-id> --task task-1 --type review
```

### `stream:events`

Stream, query, and tail structured capsule events.

Streams chronological capsule events as rich terminal ASCII tables, Markdown, or NDJSON, with sequence filtering and optional webhook delivery.

- **Aliases**: `events:stream`, `events:tail`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | no | no | - | Capsule run root. |
| `--run-id` | string | no | no | - | Capsule run identifier. |
| `--repo` | string | no | no | - | Repository root. |
| `--from-seq` | int | no | no | - | Starting event sequence number. |
| `--to-seq` | int | no | no | - | Ending event sequence number. |
| `--max-events` | int | no | no | `50` | Maximum events to return. |
| `--filter-type` | string | no | no | - | Filter events by event type name. |
| `--filter-actor` | string | no | no | - | Filter events by acting agent ID. |
| `--all` | bool | no | no | - | Return all matching events. |
| `--now` | bool | no | no | - | Return only the latest event in the log. |
| `--format` | string | no | no | - | Output format: markdown, json, or ndjson. |
| `--webhook-url` | string | no | no | - | Webhook endpoint URL for event forwarding. |
| `--webhook-retries` | int | no | no | `3` | Webhook retry attempts. |
| `--webhook-timeout` | int | no | no | `5000` | Webhook request timeout in ms. |
| `--json` | bool | no | no | - | Output JSON. |

```bash
bun harness.ts stream:events --run .olt/capsules/<run-id>
bun harness.ts stream:events --run .olt/capsules/<run-id> --from-seq 10 --max-events 20
bun harness.ts stream:events --run .olt/capsules/<run-id> --filter-type task-claimed
```

### `dag`

Render Sugiyama hierarchical DAG layout with rounded Unicode boxes and cycle diagnostics.

Computes Sugiyama layered layout, crossing minimization via barycenter heuristics, Tarjan cycle alerts, illegal bypass warnings, and orthogonal connectors. This is the canonical DAG view — report:dag and report:graph render the same graph through this same command but expose fewer flags; use this one directly rather than either of those.

- **Aliases**: `dag:render`, `dag:view`, `graph:sugiyama`, `report:sugiyama`, `graph:ascii`, `status:dag`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | no | no | - | Capsule run root. Defaults to current repository .olt/capsules/ when omitted. |
| `--run-id` | string | no | no | - | Alias of --run. |
| `--repo` | string | no | no | `.` | Repository root to search for .olt/capsules/. |
| `--detailed` | bool | no | no | - | Render full write scopes, gate commands, and dependency lists. |
| `--recommendations` | bool | no | no | - | Include algorithmic parallelization recommendations. |
| `--box-style` | string | no | no | `rounded` | Box border style: rounded, sharp, or ascii. |
| `--all` | bool | no | no | - | Do not truncate output lines. |
| `--json` | bool | no | no | - | Output structured JSON report. |

```bash
bun harness.ts dag:render --run .olt/capsules/<run-id>
bun harness.ts dag:render --detailed --box-style rounded
```

### `dag:trace`

Real-time step tracer and dynamic living DAG expansion timeline.

Replays events.jsonl to construct dynamic branch expansions and renders a chronological vertical step timeline with status glyphs and telemetry. Distinct from `dag`: this is a time-ordered event trace, not the current graph layout — use `dag` for the current wave/lane state of the graph itself.

- **Aliases**: `trace:dag`, `stream:trace`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | no | no | - | Capsule run root. |
| `--run-id` | string | no | no | - | Capsule run identifier. |
| `--repo` | string | no | no | - | Repository root. |
| `--from-seq` | int | no | no | - | Starting event sequence number. |
| `--to-seq` | int | no | no | - | Ending event sequence number. |
| `--max-steps` | int | no | no | `50` | Maximum step entries to display. |
| `--task` | string | no | no | - | Filter steps by task ID. |
| `--actor` | string | no | no | - | Filter steps by agent ID. |
| `--filter-type` | string | no | no | - | Filter steps by event kind. |
| `--detailed` | bool | no | no | - | Detailed step inspection. |
| `--all` | bool | no | no | - | Return all steps without line truncation. |

```bash
bun harness.ts dag:trace --run .olt/capsules/<run-id>
bun harness.ts dag:trace --run .olt/capsules/<run-id> --task task-1
```

### `usage:report`

Discover and report cross-platform quota, rate limit, and token usage telemetry.

Autonomously probes frontier LLM platforms (Antigravity, Claude, Cursor, OpenAI/Codex) using a 3-tier fallback strategy and generates unified ASCII telemetry tables.

- **Aliases**: `telemetry:usage`, `quota:report`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--platform` | string | no | no | - | Filter probe to a specific platform ID (antigravity, claude, cursor, openai, codex). |
| `--detailed` | bool | no | no | - | Include full raw vendor observation payloads. |
| `--json` | bool | no | no | - | Output structured JSON report. |

```bash
bun harness.ts usage:report
bun harness.ts usage:report --platform antigravity
bun harness.ts usage:report --detailed
```

### `quota:check`

Evaluate quota circuit-breaker status, wrap-up directives, and auto-wake timer schedule.

Probes cross-platform quota telemetry, detects exhaustion (<5%), generates wrap-up directives for active agents, and computes one-shot auto-wake scheduler payloads.

- **Aliases**: `quota:circuit-break`, `circuit-breaker:check`, `circuit-break`, `quota:circuit-breaker`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--platform` | string | no | no | - | Filter probe to a specific platform ID (antigravity, claude, cursor, openai, codex). |
| `--threshold` | string | no | no | `5.0` | Quota percentage threshold to trigger circuit breaker (default: 5.0). |
| `--active-agents` | int | no | no | `0` | Number of currently active agents to register in auto-wake schedule. |
| `--detailed` | bool | no | no | - | Include full vendor observation payloads. |
| `--json` | bool | no | no | - | Output structured JSON report. |

```bash
bun harness.ts quota:check
bun harness.ts quota:check --threshold 5.0
bun harness.ts quota:circuit-break --json
```

### `quota:freeze`

Initiate DAG quota freeze and create a snapshot.

Probes quota telemetry and freezes DAG operations if circuit breaker is triggered or force is applied. Outputs state to a snapshot file.

- **Aliases**: `quota:suspend`, `freeze:quota`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--repo` | string | no | no | - | Must resolve to the verified run repository. |
| `--run` | string | yes | no | - | Verified capsule run root. |
| `--actor` | string | yes | no | - | Acting mind or orchestrator agent ID. |
| `--threshold` | string | no | no | `5.0` | Quota percentage threshold (default: 5.0). |
| `--active-agents` | int | no | no | `0` | Number of currently active agents. |
| `--force` | bool | no | no | `false` | Override quota policy only; never bypasses quota evidence. |
| `--json` | bool | no | no | - | Output structured JSON report. |
| `--detailed` | bool | no | no | - | Detailed markdown output. |

```bash
bun harness.ts quota:freeze --run .olt/capsules/<run-id> --actor mind_1
```

### `quota:resume`

Resume DAG operations from a quota freeze snapshot.

Probes quota telemetry and resumes operations from a prior freeze if quota is healthy or force is applied.

- **Aliases**: `quota:unfreeze`, `resume:quota`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--repo` | string | no | no | - | Must resolve to the verified run repository. |
| `--run` | string | yes | no | - | Verified capsule run root. |
| `--actor` | string | yes | no | - | Acting mind or orchestrator agent ID. |
| `--threshold` | string | no | no | `5.0` | Quota percentage threshold (default: 5.0). |
| `--force` | bool | no | no | `false` | Override quota policy only; does not bypass run or grant authority. |
| `--json` | bool | no | no | - | Output structured JSON report. |
| `--detailed` | bool | no | no | - | Detailed markdown output. |

```bash
bun harness.ts quota:resume --run .olt/capsules/<run-id> --actor mind_1
```

### `skill:audit:live`

Live Tier 0 out-of-band audit of skill compliance and delta event forensics.

Scans incremental delta events, audits cognitive contracts, and routes defects upstream.

- **Aliases**: `skill:audit`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--repo` | string | no | no | - | Repository root path. |
| `--run` | string | no | no | - | Target capsule run root directory. |
| `--log-defects` | bool | no | no | `true` | Automatically log detected incidents as defects. |
| `--json` | bool | no | no | - | Output structured JSON. |

```bash
bun harness.ts skill:audit:live
bun harness.ts skill:audit:live --run .olt/capsules/run-1 --json
```
