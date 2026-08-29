# CLI Capability Manifest — mind (audit)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

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
bun harness.ts mind:audit-start --run .olt/capsules/mind-gen-1 --actor auditor-1 --audit-id audit-1 --window-start 2026-08-21T00:00:00Z
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
bun harness.ts mind:audit-report --run .olt/capsules/mind-gen-1 --actor auditor-1 --audit-id audit-1 --verdict approved --answer Q1:cmd-10:pass
```

### `mind:audit:live`

Live Tier 0 out-of-band audit of mind liveness, stagnation, and Mode A/B injection.

Evaluates idle duration against >120s stagnation threshold and builds verbatim role prompt.

- **Aliases**: `mind:audit`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--repo` | string | no | no | - | Repository root path. |
| `--threshold` | int | no | no | `120` | Stagnation threshold in seconds (default: 120). |
| `--conversation-id` | string | no | no | - | Target conversation identifier. |
| `--json` | bool | no | no | - | Output structured JSON. |

```bash
bun harness.ts mind:audit:live
bun harness.ts mind:audit:live --threshold 60 --json
```
