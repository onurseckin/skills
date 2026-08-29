# CLI Capability Manifest — defect

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).

### `defect:record`

Ingest and deduplicate defect records.

Parses structured defect JSONL streams, performs windowed deduplication, and serializes aggregated defect entries.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--file` | string | no | no | - | Path to defect JSONL log file. |
| `--path` | string | no | no | - | Alias for file. |
| `--content` | string | no | no | - | Raw JSONL content string. |
| `--json` | string | no | no | - | Alias for content. |
| `--jsonl` | string | no | no | - | Alias for content. |
| `--window-ms` | int | no | no | - | Deduplication window in milliseconds. |
| `--dedup-window` | int | no | no | - | Alias for window-ms. |

```bash
bun harness.ts defect:record --content '{"observation":"Bug"}'
```

### `defect:resolve`

Resolve a defect record with empirical proof.

Applies empirical resolution proof including task ID and test assertions to transition a defect record to resolved.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--defect` | string | no | no | - | Defect JSON string to resolve. |
| `--defect-json` | string | no | no | - | Alias for defect. |
| `--file` | string | no | no | - | Path to file containing defect record. |
| `--task-id` | string | no | no | - | Task ID that resolved the defect. |
| `--task` | string | no | no | - | Alias for task-id. |
| `--test-assertion` | string | no | no | - | Test assertion proving defect resolution. |
| `--assertion` | string | no | no | - | Alias for test-assertion. |
| `--commit-sha` | string | no | no | - | Commit SHA proving the resolution. |
| `--commit` | string | no | no | - | Alias for commit-sha. |
| `--notes` | string | no | no | - | Remediation explanation notes. |
| `--remediation-notes` | string | no | no | - | Alias for notes. |
| `--verified-by` | string | no | no | - | Identity of verifying agent. |
| `--resolved-at` | string | no | no | - | Timestamp override (ISO 8601). |
| `--require-commit-sha` | bool | no | no | - | Require commit SHA for resolution. |

```bash
bun harness.ts defect:resolve --task task-1 --assertion "bun test tests/unit/parser.test.ts"
```

### `defect:list`

List and parse structured defect log entries.

Parses and filters defect entries from a JSONL log file or direct stream.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--file` | string | no | no | - | Path to defect log file. |
| `--path` | string | no | no | - | Alias for file. |
| `--content` | string | no | no | - | Raw JSONL content string. |
| `--jsonl` | string | no | no | - | Alias for content. |
| `--capsule-root` | string | no | no | - | Capsule run root path. |
| `--run` | string | no | no | - | Alias for capsule-root. |

```bash
bun harness.ts defect:list --file .olt/defects.jsonl
```
