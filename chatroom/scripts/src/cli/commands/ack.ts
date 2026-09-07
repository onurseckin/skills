import * as fs from "node:fs";
import {
  assertFlags,
  boolFlag,
  intFlag,
  textFlag,
  type CommandContext,
  type CommandHandler,
  type Flags,
} from "./shared/index.ts";
import {
  assertValidRoomId,
  ChatError,
  readerCursorPath,
  readerSpoolCursorPath,
} from "../../core/index.ts";
import { assertMember } from "../../room/index.ts";
import { resolveIdentity } from "../../identity/index.ts";
import {
  ackLease,
  loadCursor,
  saveCursorCas,
  withReaderLock,
  type Confirmation,
} from "../../cursor/index.ts";
import { ensureDaemon } from "../../daemon/index.ts";

export const ackCommand: CommandHandler = async (
  flags: Flags,
  _context: CommandContext,
  _remainder: readonly string[],
): Promise<Record<string, unknown>> => {
  assertFlags(flags, ["room", "as", "reader", "lease", "through", "json"]);

  const roomFlag = textFlag(flags, "room", true);
  if (roomFlag === undefined) {
    throw new ChatError("INVALID_ARGUMENT", "--room is required");
  }
  assertValidRoomId(roomFlag);

  const asFlag = textFlag(flags, "as", false);
  const readerFlag = textFlag(flags, "reader", false);
  const leaseFlag = textFlag(flags, "lease", false);
  const throughFlag = intFlag(flags, "through", { minimum: 0 });
  const jsonFlag = boolFlag(flags, "json");

  if (leaseFlag === undefined && throughFlag === undefined) {
    throw new ChatError("INVALID_ARGUMENT", "--lease or --through is required");
  }

  const identity = resolveIdentity({ as: asFlag, cwd: process.cwd() });
  const readerId = readerFlag !== undefined ? readerFlag : identity.id;

  try {
    ensureDaemon(roomFlag, readerId);
  } catch {}

  assertMember(roomFlag, identity);

  const spoolCursorPath = readerSpoolCursorPath(roomFlag, readerId);
  const roomCursorPath = readerCursorPath(roomFlag, readerId);
  const cursorPath = fs.existsSync(spoolCursorPath) ? spoolCursorPath : roomCursorPath;

  const ackResult = withReaderLock(readerId, () => {
    const { cursor, checksum } = loadCursor(cursorPath, {
      room: roomFlag,
      reader: readerId,
    });

    let targetLeaseId = leaseFlag;
    if (targetLeaseId === undefined && throughFlag !== undefined) {
      const covering = cursor.held.find((h) => throughFlag >= h.from && throughFlag <= h.to);
      if (covering === undefined) {
        throw new ChatError("INVALID_STATE", `No live lease covers seq ${throughFlag}`);
      }
      targetLeaseId = covering.lease;
    }

    const nonNullLeaseId = targetLeaseId as string;
    const confirmation: Confirmation = {
      kind: "explicit",
      at: new Date().toISOString(),
    };

    const updatedCursor = ackLease(cursor, nonNullLeaseId, throughFlag ?? null, confirmation);
    saveCursorCas(cursorPath, updatedCursor, checksum);

    return {
      contiguous_seq: updatedCursor.contiguous_seq,
      lease_id: nonNullLeaseId,
    };
  });

  const result: Record<string, unknown> = {
    room: roomFlag,
    reader: readerId,
    lease_id: ackResult.lease_id,
    contiguous_seq: ackResult.contiguous_seq,
    acked: true,
  };

  if (!jsonFlag) {
    process.stdout.write(
      `Acked through ${ackResult.contiguous_seq} (lease: ${ackResult.lease_id})\n`,
    );
  }

  return result;
};
