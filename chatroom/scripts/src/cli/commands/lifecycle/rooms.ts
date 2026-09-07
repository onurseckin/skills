import {
  assertFlags,
  boolFlag,
  type CommandContext,
  type CommandHandler,
  type Flags,
  textFlag,
} from "../shared/index.ts";
import { listMembers, listRooms } from "../../../room/index.ts";
import { resolveIdentity } from "../../../identity/index.ts";
import { ensureDaemon } from "../../../daemon/index.ts";

export const roomsCommand: CommandHandler = async (
  flags: Flags,
  _context: CommandContext,
  _remainder: readonly string[],
): Promise<Record<string, unknown>> => {
  assertFlags(flags, ["mine", "as", "json"]);

  const mineFlag = boolFlag(flags, "mine");
  const asFlag = textFlag(flags, "as");
  const jsonFlag = boolFlag(flags, "json");

  const allRooms = listRooms();

  if (allRooms.length > 0) {
    const firstRoom = allRooms[0];
    if (firstRoom !== undefined) {
      try {
        ensureDaemon(firstRoom.id, "default", { autoStart: false });
      } catch {}
    }
  }

  let filtered = allRooms;
  if (mineFlag) {
    const identity = resolveIdentity({ as: asFlag, cwd: process.cwd() });
    const identityId = identity.id;
    filtered = allRooms.filter((r) => {
      try {
        const members = listMembers(r.id);
        return members.some((m) => m.id === identityId);
      } catch {
        return false;
      }
    });
  }

  const result: Record<string, unknown> = {
    rooms: filtered,
    count: filtered.length,
  };

  if (!jsonFlag) {
    for (const r of filtered) {
      process.stdout.write(`- ${r.id} (${r.title}) [${r.visibility}]\n`);
    }
  }

  return result;
};
