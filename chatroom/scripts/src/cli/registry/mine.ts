import { mineCommand } from "../commands/index.ts";
import { DEFAULT_EXIT_CODES, optionalFlag, type CommandSpec } from "./types.ts";

export const mineSpec: CommandSpec = {
  name: "chat:mine",
  aliases: ["mine"],
  summary: "recovery view of assigned work items across all rooms",
  description:
    "Scans all rooms and renders open work items assigned to the current identity grouped by status, highlighting unseen items.",
  flags: [
    optionalFlag("as", "string", "member identity"),
    optionalFlag("json", "bool", "machine output"),
  ],
  readsStdin: false,
  takesRemainder: false,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: ["chat:mine", "chat:mine --as bob", "chat:mine --json"],
  handler: mineCommand,
};
