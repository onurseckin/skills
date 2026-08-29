# CLI Capability Manifest — reporting (telemetry)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

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
