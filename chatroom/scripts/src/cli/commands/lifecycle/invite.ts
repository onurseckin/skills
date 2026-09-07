import {
  assertFlags,
  boolFlag,
  intFlag,
  textFlag,
  type CommandContext,
  type CommandHandler,
  type Flags,
} from "../shared/index.ts";
import { assertValidRoomId, ChatError } from "../../../core/index.ts";
import { assertMember } from "../../../room/index.ts";
import { resolveIdentity } from "../../../identity/index.ts";
import { mintInvite } from "../../../handshake/index.ts";
import { ensureDaemon } from "../../../daemon/index.ts";

export const inviteCommand: CommandHandler = async (
  flags: Flags,
  _context: CommandContext,
  _remainder: readonly string[],
): Promise<Record<string, unknown>> => {
  assertFlags(flags, ["room", "as", "ttl", "json"]);

  const roomFlag = textFlag(flags, "room", true);
  if (roomFlag === undefined) {
    throw new ChatError("INVALID_ARGUMENT", "--room is required");
  }
  assertValidRoomId(roomFlag);

  const asFlag = textFlag(flags, "as", false);
  const ttlFlag = intFlag(flags, "ttl", { minimum: 1 });
  const jsonFlag = boolFlag(flags, "json");

  const identity = resolveIdentity({ as: asFlag, cwd: process.cwd() });

  assertMember(roomFlag, identity);

  try {
    ensureDaemon(roomFlag, identity.id);
  } catch {}

  const ttl = ttlFlag !== undefined ? ttlFlag : 3600;
  const uri = mintInvite(roomFlag, identity.id, ttl);

  const result: Record<string, unknown> = {
    room: roomFlag,
    as: identity.id,
    uri,
    ttl,
  };

  if (!jsonFlag) {
    process.stdout.write(`${uri}\n`);
  }

  return result;
};
