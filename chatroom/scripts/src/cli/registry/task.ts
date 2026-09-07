import { taskCommand, topicCommand } from "../commands/index.ts";
import { DEFAULT_EXIT_CODES, optionalFlag, requiredFlag, type CommandSpec } from "./types.ts";

export const taskSpec: CommandSpec = {
  name: "chat:task",
  aliases: ["task"],
  summary: "create, transition, or comment on work items",
  description: "Manages work items, transitions status, and adds comments to task threads.",
  flags: [
    requiredFlag("room", "string", "room id"),
    optionalFlag("new", "string", "create new work item with title"),
    optionalFlag("type", "string", "story|task|bug|question|decision"),
    optionalFlag("to", "string", "assignee member id"),
    optionalFlag("parent", "string", "parent task id"),
    optionalFlag("note", "string", "comment on task thread"),
    optionalFlag("as", "string", "sender identity"),
    optionalFlag("json", "bool", "machine output"),
  ],
  readsStdin: false,
  takesRemainder: true,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: [
    "chat:task --room build-review --new 'Fix auth race condition' --type bug",
    "chat:task --room build-review TASK-1 in_progress",
    "chat:task --room build-review TASK-1 --note 'Root cause identified'",
  ],
  handler: taskCommand,
};

export const topicSpec: CommandSpec = {
  name: "chat:topic",
  aliases: ["topic"],
  summary: "print task thread in chronological order",
  description:
    "Fetches and displays the full conversation thread for a topic or task in chronological order.",
  flags: [
    requiredFlag("room", "string", "room id"),
    optionalFlag("json", "bool", "machine output"),
    optionalFlag("as", "string", "member identity"),
  ],
  readsStdin: false,
  takesRemainder: true,
  exitCodes: DEFAULT_EXIT_CODES,
  examples: [
    "chat:topic --room build-review TASK-1",
    "chat:topic --room build-review TASK-1 --json",
  ],
  handler: topicCommand,
};
