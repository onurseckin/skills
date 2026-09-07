import { briefCommand } from "../commands/index.ts";
import { DEFAULT_EXIT_CODES, optionalFlag, type CommandSpec } from "./types.ts";

export const briefSpec: CommandSpec = {
  name: "chat:brief",
  aliases: ["brief"],
  summary: "view or set member recovery brief",
  description:
    "Views or updates the recovery brief for a room member. When --set is provided, updates the recovery brief.",
  flags: [
    optionalFlag("room", "string", "room id"),
    optionalFlag("as", "string", "member identity"),
    optionalFlag("set", "string", "recovery brief text to set"),
    optionalFlag("json", "bool", "machine output"),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: [
    "chat:brief --room build-review",
    "chat:brief --room build-review --as bob",
    'chat:brief --room build-review --set "Investigating memory leak in parser"',
  ],
  handler: briefCommand,
};
