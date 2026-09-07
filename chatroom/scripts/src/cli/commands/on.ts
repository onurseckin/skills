import {
  assertFlags,
  boolFlag,
  textFlag,
  type CommandContext,
  type CommandHandler,
  type Flags,
} from "./shared/index.ts";
import { assertValidIdentity, assertValidRoomId, ChatError } from "../../core/index.ts";
import { ensureDaemon, type EnsureDaemonResult } from "../../daemon/index.ts";
import { persistNotifyCommand, type PolicyPorts } from "../../policy/index.ts";

export interface OnCommandContext extends CommandContext {
  readonly ensureDaemon?: (input: {
    readonly room: string;
    readonly reader: string;
  }) => EnsureDaemonResult;
  readonly policyPorts?: PolicyPorts;
}

export interface OnCommandResult {
  readonly ok: boolean;
  readonly action: "register";
  readonly room: string;
  readonly as: string;
  readonly command: string;
  readonly policy_path: string;
  readonly daemon: {
    readonly status: string;
    readonly pid: number | null;
    readonly healthy: boolean;
  };
  readonly markdown: string;
}

export const onCommand: CommandHandler = async (
  flags: Flags,
  context: CommandContext,
  _remainder: readonly string[],
): Promise<Record<string, unknown>> => {
  assertFlags(flags, ["room", "as", "command", "json", "policy"]);

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

  const commandRaw = textFlag(flags, "command", true);
  if (!commandRaw || commandRaw.trim().length === 0) {
    throw new ChatError("INVALID_ARGUMENT", "--command is required and cannot be empty");
  }
  const command = commandRaw.trim();

  const jsonFlag = boolFlag(flags, "json");
  const policyFlag = textFlag(flags, "policy", false);

  const ctx = context as OnCommandContext;
  const persistResult = persistNotifyCommand(command, {
    ...(policyFlag ? { policyPath: policyFlag } : {}),
    ...(ctx.policyPorts ? { ports: ctx.policyPorts } : {}),
  });

  let daemonResult: EnsureDaemonResult;
  if (typeof ctx.ensureDaemon === "function") {
    daemonResult = ctx.ensureDaemon({ room, reader: asMember });
  } else {
    try {
      daemonResult = ensureDaemon(room, asMember);
    } catch {
      daemonResult = {
        status: "failed",
        pid: null,
        healthy: false,
        probedMs: 0,
      };
    }
  }

  const lines = [
    "### Chatroom Event Registration (`chat:on`)",
    "- **Status**: `REGISTERED`",
    `- **Room**: \`${room}\``,
    `- **Member**: \`${asMember}\``,
    `- **Notify Command**: \`${command}\``,
    `- **Policy Path**: \`${persistResult.targetPath}\``,
    `- **Daemon Status**: \`${daemonResult.status}\``,
    `- **Daemon PID**: \`${daemonResult.pid ?? "none"}\``,
    `- **Daemon Healthy**: \`${daemonResult.healthy ? "yes" : "no"}\``,
  ];
  const markdown = lines.join("\n");

  const result: OnCommandResult = {
    ok: true,
    action: "register",
    room,
    as: asMember,
    command,
    policy_path: persistResult.targetPath,
    daemon: {
      status: daemonResult.status,
      pid: daemonResult.pid ?? null,
      healthy: daemonResult.healthy,
    },
    markdown,
  };

  if (!jsonFlag && !process.env.CHATROOM_TEST_QUIET) {
    process.stdout.write(`${markdown}\n`);
  }

  return result as unknown as Record<string, unknown>;
};
