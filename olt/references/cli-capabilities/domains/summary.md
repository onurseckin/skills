# CLI Capability Manifest — summary

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).

### `summary:export`

Write the graph, timeline, metrics and executive brief to disk.

Generates the summary suite under <run>/summary and, with --out, an additional registry export for the graph viewer.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--out` | string | no | no | - | Directory for the viewer registry export. |

```bash
bun harness.ts summary:export --run .olt/capsules/<run-id>
```

### `summary:view`

Render the executive brief without writing anything.

Generates the same suite in memory and returns only the markdown brief.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |

```bash
bun harness.ts summary:view --run .olt/capsules/<run-id>
```

### `test:summary`

Display or record test execution summary metadata.

Reads or records test summary records from capsule storage, showing passed/failed counts, duration, coverage, and execution scope.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | no | no | - | Capsule run root or storage directory. |
| `--json` | bool | no | no | - | Output JSON format. |
| `--passed` | int | no | no | - | Passed test count for manual summary recording. |
| `--failed` | int | no | no | - | Failed test count for manual summary recording. |
| `--skipped` | int | no | no | - | Skipped test count for manual summary recording. |
| `--duration` | int | no | no | - | Duration in milliseconds for manual summary recording. |
| `--coverage` | string | no | no | - | Coverage percentage for manual summary recording. |
| `--commit` | string | no | no | - | Commit SHA for manual summary recording. |
| `--files` | int | no | no | - | Test files count for manual summary recording. |
| `--scope` | string | no | no | - | Scope filter or recorded scope (e.g. 'full' or 'scoped'). |
| `--agent` | string | no | no | - | Agent recording the summary. |

```bash
bun harness.ts test:summary
bun harness.ts test:summary --run .olt/capsules/<run-id>
bun harness.ts test:summary --passed 45 --failed 0 --duration 1200
```
