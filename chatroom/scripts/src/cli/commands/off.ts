import {
  assertFlags,
  boolFlag,
  textFlag,
  type CommandContext,
  type CommandHandler,
  type Flags,
} from "./shared/index.ts";
import { assertValidIdentity, assertValidRoomId, ChatError } from "../../core/index.ts";
import { removeNotifyCommand, type PolicyPorts } from "../../policy/index.ts";

export interface OffCommandContext extends CommandContext {
  readonly policyPorts?: PolicyPorts;
}

export type OffCommandResult = {
  readonly ok: boolean;
  readonly action: "unregister";
  readonly room: string;
  readonly as: string;
  readonly policy_path: string;
  readonly notify_command: null;
  readonly markdown: string;
};

export const offCommand: CommandHandler = async (
  flags: Flags,
  context: CommandContext,
  _remainder: readonly string[],
): Promise<Record<string, unknown>> => {
  assertFlags(flags, ["room", "as", "json", "policy"]);

  const roomRaw = textFlag(flags, "room", true);
  if (!roomRaw || roomRaw.trim().length === 0) {
    throw new ChatError("INVALID_ARGUMENT", "--room is required and cannot be empty");
  }
  const room = roomRaw.trim();
  assertValidRoomId(room);

  const asRaw = textFlag(flags, "as", true);
  if (!asRaw || asRaw.trim().length === 0) {
    throw new ChatError("INVALID_ARGUMENT", "--as is required and cannot be empty");
  }
  const asMember = asRaw.trim();
  assertValidIdentity(asMember);

  const jsonFlag = boolFlag(flags, "json");
  const policyFlag = textFlag(flags, "policy", false);

  const ctx = context as OffCommandContext;
  const persistResult = removeNotifyCommand({
    ...(policyFlag ? { policyPath: policyFlag } : {}),
    ...(ctx.policyPorts ? { ports: ctx.policyPorts } : {}),
  });

  const lines = [
    "### Chatroom Event Unregistration (`chat:off`)",
    "- **Status**: `UNREGISTERED`",
    `- **Room**: \`${room}\``,
    `- **Member**: \`${asMember}\``,
    `- **Policy Path**: \`${persistResult.targetPath}\``,
    "- **Notify Command**: `none`",
  ];
  const markdown = lines.join("\n");

  const result: OffCommandResult = {
    ok: true,
    action: "unregister",
    room,
    as: asMember,
    policy_path: persistResult.targetPath,
    notify_command: null,
    markdown,
  };

  if (!jsonFlag && !process.env.CHATROOM_TEST_QUIET) {
    process.stdout.write(`${markdown}\n`);
  }

  return result;
};
