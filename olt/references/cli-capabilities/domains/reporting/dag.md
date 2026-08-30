# CLI Capability Manifest — reporting (dag)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

### `report:dag`

Render Sugiyama hierarchical DAG layout with rounded Unicode boxes and cycle diagnostics.

Computes Sugiyama layered layout, crossing minimization via barycenter heuristics, Tarjan cycle alerts, illegal bypass warnings, and orthogonal connectors.

- **Aliases**: none
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
bun harness.ts report:dag --run .olt/capsules/<run-id>
```
