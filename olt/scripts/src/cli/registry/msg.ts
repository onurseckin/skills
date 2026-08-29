import { msgPollCommand } from "../commands/msg-poll.ts";
import { msgRecvCommand } from "../commands/msg-recv.ts";
import { msgSendCommand } from "../commands/msg-send.ts";
import { DEFAULT_EXIT_CODES, optionalFlag, requiredFlag, type CommandSpec } from "./types.ts";

export const MSG_COMMANDS: readonly CommandSpec[] = [
  {
    name: "msg:send",
    aliases: [],
    domain: "msg",
    tier: "internal",
    internal: true,
    summary: "Send an authenticated mailbox message to an agent or role.",
    description:
      "Dispatches an HMAC-signed envelope into the recipient inbox and records it in the sender outbox.",
    flags: [
      requiredFlag("to", "string", "Recipient agent ID or role."),
      requiredFlag("type", "string", "Mailbox message type (e.g. DISPATCH_TASK, PULSE_HEARTBEAT)."),
      optionalFlag("body", "string", "Plain text message body."),
      optionalFlag("payload", "string", "JSON payload string or object data."),
      optionalFlag("actor", "string", "Sender agent ID (auto-derived if omitted)."),
      optionalFlag("role", "string", "Sender agent role (auto-derived if omitted)."),
      optionalFlag("correlation-id", "string", "Correlation ID for message threading."),
      optionalFlag("secret", "string", "Repository secret key for HMAC signing."),
      optionalFlag("base-dir", "string", "Base directory for mailbox root."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      'bun harness.ts msg:send --to worker-1 --type DISPATCH_TASK --body "Process chunk #42"',
      'bun harness.ts msg:send --to coordinator --type HANDOFF_RECEIPT --payload \'{"status":"done"}\'',
    ],
    handler: msgSendCommand,
  },
  {
    name: "msg:recv",
    aliases: [],
    domain: "msg",
    tier: "internal",
    internal: true,
    summary: "Receive unread mailbox messages from the agent inbox.",
    description:
      "Reads unread HMAC-verified messages, optionally waiting if the inbox is empty and advancing the cursor.",
    flags: [
      optionalFlag("actor", "string", "Recipient agent ID (auto-derived if omitted)."),
      optionalFlag("wait", "bool", "Wait for messages if inbox is empty."),
      optionalFlag("timeout", "int", "Timeout in milliseconds when waiting (default: 5000)."),
      optionalFlag(
        "advance-cursor",
        "bool",
        "Advance cursor after reading messages (default: true).",
      ),
      optionalFlag("no-advance-cursor", "bool", "Do not advance cursor after reading messages."),
      optionalFlag("type", "string", "Filter by message type."),
      optionalFlag("correlation-id", "string", "Filter by correlation ID."),
      optionalFlag("secret", "string", "Repository secret key for HMAC verification."),
      optionalFlag("base-dir", "string", "Base directory for mailbox root."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts msg:recv --actor worker-1",
      "bun harness.ts msg:recv --actor worker-1 --wait --timeout 10000",
    ],
    handler: msgRecvCommand,
  },
  {
    name: "msg:poll",
    aliases: [],
    domain: "msg",
    tier: "internal",
    internal: true,
    summary: "Poll mailbox for messages at regular intervals until received or timeout.",
    description:
      "Repeatedly checks the inbox at specified intervals until unread messages arrive or limits are reached.",
    flags: [
      optionalFlag("actor", "string", "Recipient agent ID (auto-derived if omitted)."),
      optionalFlag("interval", "int", "Polling interval in milliseconds (default: 500)."),
      optionalFlag("timeout", "int", "Polling timeout in milliseconds (default: 30000)."),
      optionalFlag("max-rounds", "int", "Maximum polling rounds."),
      optionalFlag(
        "advance-cursor",
        "bool",
        "Advance cursor after reading messages (default: true).",
      ),
      optionalFlag("no-advance-cursor", "bool", "Do not advance cursor after reading messages."),
      optionalFlag("type", "string", "Filter by message type."),
      optionalFlag("correlation-id", "string", "Filter by correlation ID."),
      optionalFlag("secret", "string", "Repository secret key for HMAC verification."),
      optionalFlag("base-dir", "string", "Base directory for mailbox root."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts msg:poll --actor worker-1 --interval 200 --timeout 5000",
      "bun harness.ts msg:poll --actor worker-1 --max-rounds 10",
    ],
    handler: msgPollCommand,
  },
];
