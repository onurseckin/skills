# CLI Capability Manifest — reporting (telemetry)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

### `events:trace`

Real-time step tracer and dynamic living DAG expansion timeline.

Replays events.jsonl to construct dynamic branch expansions and renders a chronological vertical step timeline with status glyphs and telemetry.

- **Aliases**: `dag:trace`
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
bun harness.ts events:trace --run .olt/capsules/<run-id>
```

### `skill:audit:live`

Live Tier 0 out-of-band audit of skill compliance and delta event forensics.

Scans incremental delta events, audits cognitive contracts, and routes defects upstream.

- **Aliases**: none
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
```

### `notify:phase`

Trigger cross-platform native OS push notification and audio chime upon phase landing.

Dispatches native desktop banner notifications and plays the macOS Glass chime upon successful upstream release landings.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--phase` | string | no | no | `OLT Release` | Name or identifier of the completed phase. |
| `--duration-ms` | int | no | no | - | Total elapsed duration in milliseconds. |
| `--tasks` | int | no | no | - | Total task count completed in the phase. |
| `--commit` | string | no | no | - | Git commit hash of the release. |
| `--title` | string | no | no | - | Custom notification title. |
| `--subtitle` | string | no | no | - | Custom notification subtitle. |
| `--details` | string | no | no | - | Additional details. |
| `--sound` | bool | no | no | `true` | Enable Glass audio chime (default: true). |
| `--no-sound` | bool | no | no | `false` | Disable audio chime. |
| `--silent` | bool | no | no | `false` | Suppress all audio/visual alerts. |
| `--json` | bool | no | no | `false` | Output structured JSON report. |

```bash
bun harness.ts notify:phase --phase 'Core Architecture' --tasks 12 --duration-ms 272000
```

### `notify:test`

Send a test native OS notification and Glass chime to verify desktop integration.

Triggers a non-blocking test notification and Glass audio chime on macOS or standard alert chime on Linux/Windows.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--no-sound` | bool | no | no | `false` | Mute audio chime. |
| `--json` | bool | no | no | `false` | Output structured JSON report. |

```bash
bun harness.ts notify:test
```
