# CLI Capability Manifest — reporting (stream)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

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
