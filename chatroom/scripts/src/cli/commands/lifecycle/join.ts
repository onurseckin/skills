import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  assertFlags,
  boolFlag,
  textFlag,
  type CommandContext,
  type CommandHandler,
  type Flags,
} from "../shared/index.ts";
import { assertValidRoomId, ChatError, writeAtomic } from "../../../core/index.ts";
import { addMember, readRoomManifest, type RosterOptions } from "../../../room/index.ts";
import { resolveIdentity } from "../../../identity/index.ts";
import {
  consumeInvite,
  formatConfirmationPreview,
  getConfirmationPreview,
  HandshakeError,
  parseInviteUri,
  validateInvite,
} from "../../../handshake/index.ts";
import { appendMessage } from "../../../log/index.ts";
import { ensureDaemon } from "../../../daemon/index.ts";

export const joinCommand: CommandHandler = async (
  flags: Flags,
  context: CommandContext,
  remainder: readonly string[],
): Promise<Record<string, unknown>> => {
  assertFlags(flags, ["invite", "room", "as", "yes", "json", "writeFile"]);

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
  let inviteCode: string | undefined;
  if (effectiveInvite !== undefined) {
    const parsed = parseInviteUri(effectiveInvite);
    targetRoomId = parsed.roomId;
    inviteCode = parsed.code;
  } else {
    const nonNullRoom = effectiveRoom as string;
    assertValidRoomId(nonNullRoom);
    targetRoomId = nonNullRoom;
  }

  const identity = resolveIdentity({ as: asFlag, cwd: process.cwd() });

  const rosterOptions: RosterOptions | undefined =
    typeof flags["writeFile"] === "function"
      ? { writeFile: flags["writeFile"] as (filePath: string, content: string) => void }
      : (context as { readonly rosterOptions?: RosterOptions })?.rosterOptions;

  let tokenConsumed = false;
  try {
    if (effectiveInvite !== undefined) {
      const validated = validateInvite(effectiveInvite);
      if (!yesFlag && !jsonFlag) {
        try {
          const preview = getConfirmationPreview(targetRoomId);
          process.stdout.write(`${formatConfirmationPreview(preview)}\n`);
        } catch {}
      }
      const chatroomDir =
        process.env["CHATROOM_HOME"] ?? path.join(os.homedir(), ".agents", "chatroom");
      const keyPath = path.join(chatroomDir, "keys", `${targetRoomId}.key`);
      if (!fs.existsSync(keyPath)) {
        const dir = path.dirname(keyPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const keyString =
          validated.key.length === 32
            ? Buffer.from(validated.key).toString("hex")
            : Buffer.from(validated.key).toString("utf8");
        writeAtomic(keyPath, Buffer.from(keyString + "\n", "utf8"), { mode: 0o600 });
      }
    } else {
      const manifest = readRoomManifest(targetRoomId);
      if (manifest.visibility !== "public") {
        throw new ChatError(
          "WRONG_ROOM",
          `Room '${targetRoomId}' is not public; an invite is required`,
        );
      }
    }

    addMember(
      targetRoomId,
      {
        id: identity.id,
        role: identity.role,
        host: identity.host,
        repo_hint: identity.repo_hint,
      },
      rosterOptions,
    );

    if (effectiveInvite !== undefined) {
      consumeInvite(effectiveInvite, identity.id);
      tokenConsumed = true;
    }
  } catch (error: unknown) {
    if (error instanceof HandshakeError || error instanceof ChatError) {
      throw error;
    }
    const errorMsg = error instanceof Error ? error.message : String(error);
    const statusStr = tokenConsumed ? "consumed" : "preserved (unconsumed)";
    const inviteInfo = inviteCode !== undefined ? ` with invite '${inviteCode}'` : "";
    throw new ChatError(
      "JOIN_FAILED",
      `Failed to join room '${targetRoomId}'${inviteInfo}: ${errorMsg}. Token status: ${statusStr}.`,
    );
  }

  try {
    ensureDaemon(targetRoomId, identity.id);
  } catch {}

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
