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

Repeatedly checks the inbox at specified intervals until unread messages arrive or limits are reached. A timeout of 0 indicates infinite timeout.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--actor` | string | no | no | - | Recipient agent ID (auto-derived if omitted). |
| `--interval` | int | no | no | - | Polling interval in milliseconds (default: 500). |
| `--timeout` | int | no | no | - | Polling timeout in milliseconds (default: 30000). A timeout of 0 indicates infinite timeout. |
| `--max-rounds` | int | no | no | - | Maximum polling rounds. |
| `--continuous` | bool | no | no | - | Run continuously without exiting on first message batch. |
| `--advance-cursor` | bool | no | no | - | Advance cursor after reading messages (default: true). |
| `--no-advance-cursor` | bool | no | no | - | Do not advance cursor after reading messages. |
| `--type` | string | no | no | - | Filter by message type. |
| `--correlation-id` | string | no | no | - | Filter by correlation ID. |
| `--secret` | string | no | no | - | Repository secret key for HMAC verification. |
| `--base-dir` | string | no | no | - | Base directory for mailbox root. |
| `--json` | bool | no | no | - | Output machine-readable JSON. |

```bash
bun harness.ts msg:poll --actor worker-1 --interval 200 --timeout 5000
bun harness.ts msg:poll --actor worker-1 --max-rounds 10
bun harness.ts msg:poll --actor worker-1 --type DISPATCH_TASK
```

### `msg:listen`

Continuously listen for and drain incoming mailbox messages.

Starts continuous draining on the agent mailbox, streaming incoming messages until interrupted.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--actor` | string | no | no | - | Recipient agent ID (auto-derived if omitted). |
| `--interval` | int | no | no | - | Polling interval / idle wait in milliseconds (default: 50). |
| `--batch-size` | int | no | no | - | Maximum messages to process per drain pass. |
| `--base-dir` | string | no | no | - | Base directory for mailbox root. |
| `--secret` | string | no | no | - | Repository secret key for HMAC verification. |
| `--json` | bool | no | no | - | Emit JSON output rather than text stream. |
| `--timeout` | int | no | no | - | Drain timeout in milliseconds. |
| `--max-messages` | int | no | no | - | Maximum messages to process before stopping. |

```bash
bun harness.ts msg:listen --actor worker-1
bun harness.ts msg:listen --actor worker-1 --interval 50 --batch-size 10
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
| `--detailed` | bool | no | no | - | Show detailed per-message delivery status. |
| `--verbose` | bool | no | no | - | Alias for detailed per-message delivery status. |
| `--message-id` | string | no | no | - | Inspect delivery status of a specific message ID. |
| `--id` | string | no | no | - | Alias for message-id. |

```bash
bun harness.ts msg:list
bun harness.ts msg:list --actor worker-1
bun harness.ts msg:list --base-dir /path/to/project
```

### `msg:health`

Check mailbox listener liveness and health status.

Inspects listener heartbeat, lock state, process status, and delivery metrics to determine listener health.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--actor` | string | no | no | - | Recipient agent ID (auto-derived if omitted). |
| `--base-dir` | string | no | no | - | Base directory for mailbox root. |

```bash
bun harness.ts msg:health
bun harness.ts msg:health --actor worker-1
bun harness.ts msg:health --base-dir /path/to/project
```
