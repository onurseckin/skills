# CLI Capability Manifest — msg

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).

### `msg:send`

Send an authenticated mailbox message to an agent or role.

Dispatches an HMAC-signed envelope into the recipient inbox and records it in the sender outbox.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--to` | string | yes | no | - | Recipient agent ID or role. |
| `--type` | string | yes | no | - | Mailbox message type (e.g. DISPATCH_TASK, PULSE_HEARTBEAT). |
| `--body` | string | no | no | - | Plain text message body. |
| `--payload` | string | no | no | - | JSON payload string or object data. |
| `--actor` | string | no | no | - | Sender agent ID (auto-derived if omitted). |
| `--role` | string | no | no | - | Sender agent role (auto-derived if omitted). |
| `--correlation-id` | string | no | no | - | Correlation ID for message threading. |
| `--secret` | string | no | no | - | Repository secret key for HMAC signing. |
| `--base-dir` | string | no | no | - | Base directory for mailbox root. |

```bash
bun harness.ts msg:send --to worker-1 --type DISPATCH_TASK --body "Process chunk #42"
bun harness.ts msg:send --to coordinator --type HANDOFF_RECEIPT --payload '{"status":"done"}'
bun harness.ts msg:send --to mechanic-1 --type DIRECTIVE --body "Run diagnostics" --correlation-id corr-101
```

### `msg:recv`

Receive unread mailbox messages from the agent inbox.

Reads unread HMAC-verified messages, optionally waiting if the inbox is empty and advancing the cursor.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--actor` | string | no | no | - | Recipient agent ID (auto-derived if omitted). |
| `--wait` | bool | no | no | - | Wait for messages if inbox is empty. |
| `--timeout` | int | no | no | - | Timeout in milliseconds when waiting (default: 5000). |
| `--advance-cursor` | bool | no | no | - | Advance cursor after reading messages (default: true). |
| `--no-advance-cursor` | bool | no | no | - | Do not advance cursor after reading messages. |
| `--type` | string | no | no | - | Filter by message type. |
| `--correlation-id` | string | no | no | - | Filter by correlation ID. |
| `--secret` | string | no | no | - | Repository secret key for HMAC verification. |
| `--base-dir` | string | no | no | - | Base directory for mailbox root. |

```bash
bun harness.ts msg:recv --actor worker-1
bun harness.ts msg:recv --actor worker-1 --wait --timeout 10000
bun harness.ts msg:recv --actor worker-1 --type DISPATCH_TASK --no-advance-cursor
```

### `msg:poll`

Poll mailbox for messages at regular intervals until received or timeout.

Repeatedly checks the inbox at specified intervals until unread messages arrive or limits are reached.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--actor` | string | no | no | - | Recipient agent ID (auto-derived if omitted). |
| `--interval` | int | no | no | - | Polling interval in milliseconds (default: 500). |
| `--timeout` | int | no | no | - | Polling timeout in milliseconds (default: 30000). |
| `--max-rounds` | int | no | no | - | Maximum polling rounds. |
| `--advance-cursor` | bool | no | no | - | Advance cursor after reading messages (default: true). |
| `--no-advance-cursor` | bool | no | no | - | Do not advance cursor after reading messages. |
| `--type` | string | no | no | - | Filter by message type. |
| `--correlation-id` | string | no | no | - | Filter by correlation ID. |
| `--secret` | string | no | no | - | Repository secret key for HMAC verification. |
| `--base-dir` | string | no | no | - | Base directory for mailbox root. |

```bash
bun harness.ts msg:poll --actor worker-1 --interval 200 --timeout 5000
bun harness.ts msg:poll --actor worker-1 --max-rounds 10
bun harness.ts msg:poll --actor worker-1 --type DISPATCH_TASK
```

### `msg:list`

List mailbox summaries and unread counts across agents.

Scans the repository mailbox store to report message counts, unread queue depths, outbox activity, and quarantine status per agent.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--actor` | string | no | no | - | Filter mailbox summary to a single agent ID. |
| `--base-dir` | string | no | no | - | Base directory for mailbox root. |

```bash
bun harness.ts msg:list
bun harness.ts msg:list --actor worker-1
bun harness.ts msg:list --base-dir /path/to/project
```
