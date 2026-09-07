import { offCommand, onCommand } from "../commands/index.ts";
import { DEFAULT_EXIT_CODES, optionalFlag, requiredFlag, type CommandSpec } from "./types.ts";

export const onSpec: CommandSpec = {
  name: "chat:on",
  aliases: ["on"],
  summary: "register notification command hook and ensure daemon",
  description:
    "Registers notify_command into policy and immediately ensures the room daemon is running.",
  flags: [
    requiredFlag("room", "string", "room id"),
    requiredFlag("as", "string", "member identity"),
    requiredFlag("command", "string", "command to execute on delivery"),
    optionalFlag("json", "bool", "machine output"),
    optionalFlag("policy", "string", "path to policy.json file"),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: [
    'chat:on --room build-review --as bot --command "echo new message"',
    "chat:on --room dev-chat --as assistant --command \"notify-send 'New message'\"",
  ],
  handler: onCommand,
};

export const offSpec: CommandSpec = {
  name: "chat:off",
  aliases: ["off"],
  summary: "unregister notification command hook",
  description: "Removes notify_command from policy.",
  flags: [
    requiredFlag("room", "string", "room id"),
    requiredFlag("as", "string", "member identity"),
    optionalFlag("json", "bool", "machine output"),
    optionalFlag("policy", "string", "path to policy.json file"),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: ["chat:off --room build-review --as bot", "chat:off --room dev-chat --as assistant"],
  handler: offCommand,
};
