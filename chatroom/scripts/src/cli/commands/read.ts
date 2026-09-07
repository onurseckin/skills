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
  daemonOutSpoolPath,
  delay,
  readerCursorPath,
  readerSpoolCursorPath,
  roomLogDir,
} from "../../core/index.ts";
import { assertMember } from "../../room/index.ts";
import { resolveIdentity } from "../../identity/index.ts";
import { scanRange } from "../../log/index.ts";
import {
  leaseNext,
  loadCursor,
  saveCursorCas,
  withReaderLock,
  type LeaseResult,
} from "../../cursor/index.ts";
import { ensureDaemon } from "../../daemon/index.ts";

export const readCommand: CommandHandler = async (
  flags: Flags,
  _context: CommandContext,
  _remainder: readonly string[],
): Promise<Record<string, unknown>> => {
  assertFlags(flags, [
    "room",
    "as",
    "reader",
    "limit",
    "source",
    "wait",
    "peek",
    "type",
    "since",
    "json",
  ]);

  const roomFlag = textFlag(flags, "room", true);
  if (roomFlag === undefined) {
    throw new ChatError("INVALID_ARGUMENT", "--room is required");
  }
  assertValidRoomId(roomFlag);

  const asFlag = textFlag(flags, "as", false);
  const readerFlag = textFlag(flags, "reader", false);
  const limitFlag = intFlag(flags, "limit", { minimum: 1, maximum: 500 });
  const sourceFlag = textFlag(flags, "source", false);
  const waitFlag = intFlag(flags, "wait", { minimum: 0 });
  const peekFlag = boolFlag(flags, "peek");
  const typeFlag = textFlag(flags, "type", false);
  const sinceFlag = intFlag(flags, "since", { minimum: 0 });
  const jsonFlag = boolFlag(flags, "json");

  if (!peekFlag && (typeFlag !== undefined || sinceFlag !== undefined)) {
    throw new ChatError("FILTER_REQUIRES_PEEK", "--type and --since can only be used with --peek");
  }

  const identity = resolveIdentity({ as: asFlag, cwd: process.cwd() });
  const readerId = readerFlag !== undefined ? readerFlag : identity.id;

  assertMember(roomFlag, identity);

  try {
    ensureDaemon(roomFlag, readerId);
  } catch {}

  const limit = limitFlag !== undefined ? limitFlag : 50;

  if (peekFlag) {
    const startSeq = sinceFlag !== undefined ? sinceFlag + 1 : 1;
    const scanned = scanRange(roomFlag, startSeq, startSeq + limit - 1);
    const filtered =
      typeFlag !== undefined
        ? scanned.filter(
            (env) =>
              env.kind === typeFlag || (env.body !== undefined && env.body.schema === typeFlag),
          )
        : scanned;

    const result: Record<string, unknown> = {
      room: roomFlag,
      reader: readerId,
      peek: true,
      count: filtered.length,
      messages: filtered,
    };

    if (!jsonFlag) {
      for (const msg of filtered) {
        process.stdout.write(`[${msg.seq}] <${msg.sender.id}> ${msg.text ?? ""}\n`);
      }
    }

    return result;
  }

  const source = sourceFlag !== undefined ? sourceFlag : "spool";
  const waitMs = waitFlag !== undefined ? waitFlag : 0;

  let cursorPath: string;
  let logTarget: string;
  if (source === "spool") {
    cursorPath = readerSpoolCursorPath(roomFlag, readerId);
    const spoolFile = daemonOutSpoolPath(roomFlag, readerId);
    logTarget = fs.existsSync(spoolFile) ? spoolFile : roomLogDir(roomFlag);
  } else {
    cursorPath = readerCursorPath(roomFlag, readerId);
    logTarget = roomLogDir(roomFlag);
  }

  const startTime = Date.now();
  let leaseResult: LeaseResult;

  while (true) {
    leaseResult = withReaderLock(readerId, () => {
      const { cursor, checksum } = loadCursor(cursorPath, {
        room: roomFlag,
        reader: readerId,
      });
      const res = leaseNext(cursor, logTarget, limit);
      if (res.leaseId !== null && res.messages.length > 0) {
        saveCursorCas(cursorPath, res.cursor, checksum);
      }
      return res;
    });

    if (leaseResult.messages.length > 0 || waitMs <= 0 || Date.now() - startTime >= waitMs) {
      break;
    }

    await delay(Math.min(100, waitMs));
  }

  const result: Record<string, unknown> = {
    room: roomFlag,
    reader: readerId,
    lease_id: leaseResult.leaseId,
    count: leaseResult.messages.length,
    messages: leaseResult.messages,
  };

  if (!jsonFlag) {
    if (leaseResult.leaseId !== null) {
      process.stdout.write(
        `Lease: ${leaseResult.leaseId} (${leaseResult.messages.length} messages)\n`,
      );
    }
    for (const msg of leaseResult.messages) {
      process.stdout.write(`[${msg.seq}] <${msg.sender.id}> ${msg.text ?? ""}\n`);
    }
  }

  return result;
};
