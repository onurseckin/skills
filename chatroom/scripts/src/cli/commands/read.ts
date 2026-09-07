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
  resolveActiveConsumerCursorPath,
  roomLogDir,
  type Envelope,
} from "../../core/index.ts";
import { assertMember } from "../../room/index.ts";
import { resolveIdentity } from "../../identity/index.ts";
import {
  ackLease,
  leaseNext,
  loadCursor,
  saveCursorCas,
  withReaderLock,
  type Confirmation,
  type LeaseResult,
} from "../../cursor/index.ts";
import { ensureDaemon } from "../../daemon/index.ts";
import { processAutoAcknowledge } from "../../work/index.ts";

export const readCommand: CommandHandler = async (
  flags: Flags,
  _context: CommandContext,
  _remainder: readonly string[],
): Promise<Record<string, unknown>> => {
  assertFlags(flags, ["room", "as", "limit", "wait", "json"]);

  const roomFlag = textFlag(flags, "room", true);
  if (roomFlag === undefined) {
    throw new ChatError("INVALID_ARGUMENT", "--room is required");
  }
  assertValidRoomId(roomFlag);

  const asFlag = textFlag(flags, "as", false);
  const limitFlag = intFlag(flags, "limit", { minimum: 1, maximum: 500 });
  const waitFlag = intFlag(flags, "wait", { minimum: 0 });
  const jsonFlag = boolFlag(flags, "json");

  const identity = resolveIdentity({ as: asFlag, cwd: process.cwd() });
  const readerId = identity.id;

  assertMember(roomFlag, identity);

  try {
    ensureDaemon(roomFlag, readerId);
  } catch {}

  const limit = limitFlag !== undefined ? limitFlag : 50;

  const waitMs = waitFlag !== undefined ? waitFlag : 0;

  const cursorPath = resolveActiveConsumerCursorPath(roomFlag, readerId, fs.existsSync);
  const spoolFile = daemonOutSpoolPath(roomFlag, readerId);
  const hasSpool = fs.existsSync(spoolFile);
  const logTarget = hasSpool ? spoolFile : roomLogDir(roomFlag);

  const startTime = Date.now();
  let leaseResult: LeaseResult;

  while (true) {
    leaseResult = withReaderLock(roomFlag, readerId, () => {
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

  if (leaseResult.messages.length > 0) {
    processAutoAcknowledge(
      roomFlag,
      readerId,
      leaseResult.messages as unknown as readonly Envelope[],
    );
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
      const bodyData =
        typeof msg.body === "object" &&
        msg.body !== null &&
        "data" in msg.body &&
        typeof (msg.body as { data: unknown }).data === "object" &&
        (msg.body as { data: unknown }).data !== null
          ? (msg.body as { data: Record<string, unknown> }).data
          : undefined;
      const bodyText =
        typeof bodyData?.["text"] === "string" ? (bodyData["text"] as string) : undefined;
      const displayText = msg.text ?? bodyText;
      if (
        msg.kind === "message" &&
        (displayText === undefined || displayText.trim().length === 0)
      ) {
        throw new ChatError(
          "INVALID_STATE",
          `Envelope ${msg.id} (seq ${msg.seq}) has empty displayable content`,
        );
      }
      process.stdout.write(`[${msg.seq}] <${msg.sender.id}> ${displayText ?? ""}\n`);
    }
  }

  if (leaseResult.leaseId !== null && leaseResult.messages.length > 0) {
    const confirmation: Confirmation = {
      kind: "explicit",
      at: new Date().toISOString(),
    };
    withReaderLock(roomFlag, readerId, () => {
      const { cursor, checksum } = loadCursor(cursorPath, { room: roomFlag, reader: readerId });
      const updated = ackLease(cursor, leaseResult.leaseId!, null, confirmation);
      saveCursorCas(cursorPath, updated, checksum);
    });
  }

  return result;
};
