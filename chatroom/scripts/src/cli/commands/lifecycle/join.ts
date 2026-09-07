import {
  assertFlags,
  boolFlag,
  textFlag,
  type CommandContext,
  type CommandHandler,
  type Flags,
} from "../shared/index.ts";
import { assertValidRoomId, ChatError } from "../../../core/index.ts";
import { addMember, readRoomManifest } from "../../../room/index.ts";
import { resolveIdentity } from "../../../identity/index.ts";
import {
  consumeInvite,
  formatConfirmationPreview,
  getConfirmationPreview,
  parseInviteUri,
} from "../../../handshake/index.ts";
import { appendMessage } from "../../../log/index.ts";
import { ensureDaemon } from "../../../daemon/index.ts";

export const joinCommand: CommandHandler = async (
  flags: Flags,
  _context: CommandContext,
  remainder: readonly string[],
): Promise<Record<string, unknown>> => {
  assertFlags(flags, ["invite", "room", "as", "yes", "json"]);

  const inviteFlag = textFlag(flags, "invite", false);
  const roomFlag = textFlag(flags, "room", false);
  const asFlag = textFlag(flags, "as", false);
  const yesFlag = boolFlag(flags, "yes");
  const jsonFlag = boolFlag(flags, "json");

  let effectiveInvite = inviteFlag;
  let effectiveRoom = roomFlag;

  if (effectiveInvite === undefined && effectiveRoom === undefined && remainder.length > 0) {
    const arg = remainder[0];
    if (arg !== undefined) {
      if (arg.startsWith("chatroom://")) {
        effectiveInvite = arg;
      } else {
        effectiveRoom = arg;
      }
    }
  }

  if (effectiveInvite === undefined && effectiveRoom === undefined) {
    throw new ChatError("INVALID_ARGUMENT", "--invite or --room is required");
  }

  let targetRoomId: string;
  if (effectiveInvite !== undefined) {
    const parsed = parseInviteUri(effectiveInvite);
    targetRoomId = parsed.roomId;
  } else {
    const nonNullRoom = effectiveRoom as string;
    assertValidRoomId(nonNullRoom);
    targetRoomId = nonNullRoom;
  }

  const identity = resolveIdentity({ as: asFlag, cwd: process.cwd() });

  try {
    ensureDaemon(targetRoomId, identity.id);
  } catch {}

  if (effectiveInvite !== undefined) {
    if (!yesFlag && !jsonFlag) {
      try {
        const preview = getConfirmationPreview(targetRoomId);
        process.stdout.write(`${formatConfirmationPreview(preview)}\n`);
      } catch {}
    }
    consumeInvite(effectiveInvite, identity.id);
  } else {
    const manifest = readRoomManifest(targetRoomId);
    if (manifest.visibility !== "public") {
      throw new ChatError(
        "WRONG_ROOM",
        `Room '${targetRoomId}' is not public; an invite is required`,
      );
    }
  }

  addMember(targetRoomId, {
    id: identity.id,
    role: identity.role,
    host: identity.host,
    repo_hint: identity.repo_hint,
  });

  try {
    appendMessage(targetRoomId, {
      sender: {
        id: identity.id,
        role: identity.role,
        host: identity.host,
        ...(identity.repo_hint !== undefined ? { repo_hint: identity.repo_hint } : {}),
        pid: process.pid,
      },
      kind: "roster",
      text: `${identity.id} joined the room`,
      body: {
        schema: "chatroom.roster.v1",
        data: {
          agents: [
            {
              id: identity.id,
              role: identity.role,
              host: identity.host,
              status: "joined",
            },
          ],
        },
      },
    });
  } catch {}

  const result: Record<string, unknown> = {
    room: targetRoomId,
    as: identity.id,
    joined: true,
  };

  if (!jsonFlag) {
    process.stdout.write(`Joined room '${targetRoomId}' as '${identity.id}'\n`);
  }

  return result;
};
