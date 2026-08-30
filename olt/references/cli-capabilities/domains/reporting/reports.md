# CLI Capability Manifest — reporting (reports)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

### `report`

Deliver unified topology, lifecycle tier breakdown, agent roles, IDs, and timestamps.

Generates comprehensive unified run report across tasks, topology, agent lifecycle tiers, and audit trail.

- **Aliases**: none
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

### `report:usage`

Discover and report cross-platform quota, rate limit, and token usage telemetry.

Autonomously probes frontier LLM platforms (Antigravity, Claude, Cursor, OpenAI/Codex) using a 3-tier fallback strategy and generates unified ASCII telemetry tables.

- **Aliases**: `usage:report`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--platform` | string | no | no | - | Filter probe to a specific platform ID (antigravity, claude, cursor, openai, codex). |
| `--detailed` | bool | no | no | - | Include full raw vendor observation payloads. |
| `--json` | bool | no | no | - | Output structured JSON report. |

```bash
bun harness.ts report:usage
bun harness.ts report:usage --platform antigravity
bun harness.ts report:usage --detailed
```

### `report:graph-json`

Export DAG telemetry and metrics to JSON.

Export DAG telemetry and metrics to JSON.

- **Aliases**: none
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
