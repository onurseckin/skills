import {
  ackCommand,
  daemonCommand,
  doctorCommand,
  initCommand,
  inviteCommand,
  joinCommand,
  readCommand,
  roomsCommand,
  sayCommand,
  watchCommand,
} from "../commands/index.ts";
import {
  DEFAULT_EXIT_CODES,
  optionalFlag,
  repeatableFlag,
  requiredFlag,
  type CommandSpec,
} from "./types.ts";
import { offSpec, onSpec } from "./policy.ts";

export const initSpec: CommandSpec = {
  name: "chat:init",
  aliases: ["init"],
  summary: "provision room, communicator agent, cron, and daemon",
  description:
    "Creates or joins a room and provisions the host's communicator agent, its cron, and its daemon.",
  flags: [
    optionalFlag("room", "string", "room id"),
    optionalFlag("title", "string", "human title, used in the join confirmation"),
    optionalFlag(
      "as",
      "string",
      "member id to bind for this host+repo; defaults to a generated <host>-<repo-basename>",
    ),
    optionalFlag(
      "host",
      "string",
      "antigravity | claude_code | codex | cursor | auto (default auto)",
    ),
    optionalFlag("public", "bool", "create a public room"),
    optionalFlag("invite", "string", "join via a chatroom:// URI instead of creating"),
    optionalFlag("repo", "string", "repository root to bind (default: cwd)"),
    optionalFlag("no-agent", "bool", "skip communicator agent generation"),
    optionalFlag("no-daemon", "bool", "skip daemon start"),
    optionalFlag("print-invite", "bool", "mint and print a first invite immediately"),
    optionalFlag("rotate-key", "bool", "rotate the room key and invalidate existing invites"),
    optionalFlag("json", "bool", "machine output"),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: [
    "chat:init --room build-review",
    "chat:init --invite chatroom://build-review#sha256:8f3a.inv-42",
  ],
  handler: initCommand,
};

export const inviteSpec: CommandSpec = {
  name: "chat:invite",
  aliases: ["invite"],
  summary: "mint a one-time invite",
  description: "Mints a single-use cryptographically signed invite URI for a room.",
  flags: [
    requiredFlag("room", "string", "room id"),
    optionalFlag("as", "string", "minter identity"),
    optionalFlag("ttl", "int", "seconds until the invite expires (default 3600)"),
    optionalFlag("json", "bool", "machine output"),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: ["chat:invite --room build-review", "chat:invite --room build-review --ttl 7200"],
  handler: inviteCommand,
};

export const joinSpec: CommandSpec = {
  name: "chat:join",
  aliases: ["join"],
  summary: "join a room",
  description: "Takes the invite URI as a bare remainder argument or via --invite.",
  flags: [
    optionalFlag("invite", "string", "chatroom://<room>#<fingerprint>.<code>"),
    optionalFlag("room", "string", "public room id (no invite needed)"),
    optionalFlag("as", "string", "member id to register"),
    optionalFlag("yes", "bool", "accept the confirmation preview without prompting"),
    optionalFlag("json", "bool", "machine output"),
  ],
  readsStdin: false,
  takesRemainder: true,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: [
    "chat:join --invite chatroom://build-review#sha256:8f3a.inv-42",
    "chat:join chatroom://build-review#sha256:8f3a.inv-42",
    "chat:join --room public-channel",
  ],
  handler: joinCommand,
};

export const saySpec: CommandSpec = {
  name: "chat:say",
  aliases: ["say"],
  summary: "post a message",
  description: "Appends a message to the shared room log.",
  flags: [
    requiredFlag("room", "string", "room id"),
    optionalFlag("as", "string", "sender identity; resolved through identity model"),
    optionalFlag("text", "string", "prose"),
    optionalFlag("payload", "string", "inline JSON object for body.data"),
    optionalFlag("payload-file", "string", "path to a JSON file for body.data"),
    optionalFlag("schema", "string", "body.schema (default chatroom.text.v1)"),
    optionalFlag("kind", "string", "envelope kind (default message)"),
    repeatableFlag("to", "string", "advisory mentions; never affects delivery"),
    optionalFlag("thread", "string", "grouping key"),
    optionalFlag("reply-to", "string", "envelope id"),
    optionalFlag("json", "bool", "machine output"),
  ],
  readsStdin: true,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: [
    "chat:say --room build-review --text 'Gate G3 passed'",
    'chat:say --room build-review --payload \'{"gate_id":"G3","passed":true}\' --schema chatroom.gate_result.v1',
  ],
  handler: sayCommand,
};

export const readSpec: CommandSpec = {
  name: "chat:read",
  aliases: ["read"],
  summary: "lease the next batch",
  description:
    "Leases a contiguous range of unread envelopes for this reader without advancing contiguous_seq.",
  flags: [
    requiredFlag("room", "string", "room id"),
    optionalFlag("as", "string", "member identity"),
    optionalFlag("limit", "int", "max envelopes in the batch (default 50, max 500)"),
    optionalFlag("wait", "int", "ms to block for arrival; 0 (default) returns immediately"),
    optionalFlag("peek", "bool", "read-only: no lease, no cursor mutation, no ack possible"),
    optionalFlag("type", "string", "--peek only; display filter"),
    optionalFlag("since", "int", "--peek only; start seq"),
    optionalFlag("json", "bool", "machine output"),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: [
    "chat:read --room build-review",
    "chat:read --room build-review --peek",
    "chat:read --room build-review --wait 5000",
  ],
  handler: readCommand,
};

export const ackSpec: CommandSpec = {
  name: "chat:ack",
  aliases: ["ack"],
  summary: "confirm delivery",
  description: "Confirms delivery and advances reader's contiguous_seq.",
  flags: [
    requiredFlag("room", "string", "room id"),
    optionalFlag("as", "string", "member identity"),
    optionalFlag("lease", "string", "lease id returned by chat:read"),
    optionalFlag("through", "int", "ack every seq in the named lease up to this seq (partial ack)"),
    optionalFlag("json", "bool", "machine output"),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: [
    "chat:ack --room build-review --lease L-7c2f",
    "chat:ack --room build-review --through 820",
  ],
  handler: ackCommand,
};

export const watchSpec: CommandSpec = {
  name: "chat:watch",
  aliases: ["watch"],
  summary: "foreground live consumer",
  description: "Blocks and streams batches as they arrive using lease/ack machinery.",
  flags: [
    requiredFlag("room", "string", "room id"),
    optionalFlag("as", "string", "member identity"),
    optionalFlag("reader", "string", "consumer-group id"),
    optionalFlag("ack-mode", "string", "explicit (default) or flushed"),
    optionalFlag("timeout", "int", "ms; 0 = forever (default 0)"),
    optionalFlag("json", "bool", "machine output"),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: ["chat:watch --room build-review", "chat:watch --room build-review --ack-mode flushed"],
  handler: watchCommand,
};

export const daemonSpec: CommandSpec = {
  name: "chat:daemon",
  aliases: ["daemon"],
  summary: "daemon lifecycle",
  description: "Manages daemon background process and supervisor.",
  flags: [
    requiredFlag("room", "string", "room id"),
    optionalFlag("as", "string", "member identity"),
    optionalFlag("reader", "string", "consumer-group id"),
    optionalFlag("start", "bool", "idempotent start (or report already_running)"),
    optionalFlag("stop", "bool", "graceful stop; releases the lock; writes state: STOPPED"),
    optionalFlag("status", "bool", "print the health record and computed state"),
    optionalFlag("tick", "bool", "one-shot supervise-and-deliver; the cron entry point"),
    optionalFlag("foreground", "bool", "run the loop in this process instead of detaching"),
    optionalFlag("poll-interval", "int", "override the poll floor for this daemon"),
    optionalFlag("json", "bool", "machine output"),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: [
    "chat:daemon --room build-review --start",
    "chat:daemon --room build-review --status",
    "chat:daemon --room build-review --tick",
  ],
  handler: daemonCommand,
};

export const doctorSpec: CommandSpec = {
  name: "chat:doctor",
  aliases: ["doctor"],
  summary: "health and repair",
  description:
    "Checks health, reclaims stale locks, repairs torn spool lines, and restarts dead daemons.",
  flags: [
    optionalFlag("room", "string", "omit to check every room the user is a member of"),
    optionalFlag("as", "string", "member identity"),
    optionalFlag("reader", "string", "consumer-group id"),
    optionalFlag(
      "fix",
      "bool",
      "reclaim stale locks, repair torn spool lines, restart dead daemons",
    ),
    optionalFlag("json", "bool", "machine output"),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: ["chat:doctor", "chat:doctor --room build-review --fix"],
  handler: doctorCommand,
};

export const roomsSpec: CommandSpec = {
  name: "chat:rooms",
  aliases: ["rooms"],
  summary: "list rooms",
  description: "Lists discoverable rooms.",
  flags: [
    optionalFlag("mine", "bool", "only rooms where the resolved identity is a member"),
    optionalFlag("json", "bool", "machine output"),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: ["chat:rooms", "chat:rooms --mine"],
  handler: roomsCommand,
};

export const CHAT_COMMANDS: readonly CommandSpec[] = [
  initSpec,
  inviteSpec,
  joinSpec,
  saySpec,
  readSpec,
  ackSpec,
  watchSpec,
  daemonSpec,
  doctorSpec,
  roomsSpec,
  onSpec,
  offSpec,
];

export { offSpec, onSpec } from "./policy.ts";

export function allCommands(): readonly CommandSpec[] {
  return CHAT_COMMANDS;
}

export function findCommand(name: string): CommandSpec | undefined {
  const normalized = name.trim().toLowerCase();
  for (const command of CHAT_COMMANDS) {
    if (command.name.toLowerCase() === normalized) {
      return command;
    }
    for (const alias of command.aliases) {
      if (alias.toLowerCase() === normalized) {
        return command;
      }
    }
  }
  return undefined;
}

export function commandInvocations(): readonly string[] {
  const invocations: string[] = [];
  for (const command of CHAT_COMMANDS) {
    invocations.push(command.name);
    for (const alias of command.aliases) {
      invocations.push(alias);
    }
  }
  return invocations;
}
