import {
  assertFlags,
  boolFlag,
  type CommandContext,
  type CommandHandler,
  type Flags,
} from "../shared/index.ts";
import { listMembers, listRooms } from "../../../room/index.ts";
import { resolveIdentity } from "../../../identity/index.ts";
import { ensureDaemon } from "../../../daemon/index.ts";

export const roomsCommand: CommandHandler = async (
  flags: Flags,
  _context: CommandContext,
  _remainder: readonly string[],
): Promise<Record<string, unknown>> => {
  assertFlags(flags, ["mine", "json"]);

  const mineFlag = boolFlag(flags, "mine");
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
    let identityId: string | undefined = undefined;
    try {
      const identity = resolveIdentity({ cwd: process.cwd() });
      identityId = identity.id;
    } catch {}

    if (identityId !== undefined) {
      filtered = allRooms.filter((r) => {
        try {
          const members = listMembers(r.id);
          return members.some((m) => m.id === identityId);
        } catch {
          return false;
        }
      });
    } else {
      filtered = [];
    }
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
