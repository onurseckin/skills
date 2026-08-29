# CLI Capability Manifest — reporting (reports)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

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
