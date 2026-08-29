# CLI Capability Manifest — reporting (dag)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

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
