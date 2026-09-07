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
  delay,
  resolveActiveConsumerCursorPath,
  roomLogDir,
} from "../../core/index.ts";
import { assertMember } from "../../room/index.ts";
import { resolveIdentity } from "../../identity/index.ts";
import {
  leaseNext,
  loadCursor,
  saveCursorCas,
  withReaderLock,
  type LeaseResult,
  type LogEnvelope,
} from "../../cursor/index.ts";
import { ensureDaemon } from "../../daemon/index.ts";

export const watchCommand: CommandHandler = async (
  flags: Flags,
  _context: CommandContext,
  _remainder: readonly string[],
): Promise<Record<string, unknown>> => {
  assertFlags(flags, ["room", "as", "timeout", "json"]);

  const roomFlag = textFlag(flags, "room", true);
  if (roomFlag === undefined) {
    throw new ChatError("INVALID_ARGUMENT", "--room is required");
  }
  assertValidRoomId(roomFlag);

  const asFlag = textFlag(flags, "as", false);
  const timeoutFlag = intFlag(flags, "timeout", { minimum: 0 });
  const jsonFlag = boolFlag(flags, "json");

  const identity = resolveIdentity({ as: asFlag, cwd: process.cwd() });
  const readerId = identity.id;
  const ackMode = "explicit";

  assertMember(roomFlag, identity);

  try {
    ensureDaemon(roomFlag, readerId);
  } catch {}

  const cursorPath = resolveActiveConsumerCursorPath(roomFlag, readerId, fs.existsSync);
  const logTarget = roomLogDir(roomFlag);

  const timeoutMs = timeoutFlag !== undefined ? timeoutFlag : 0;
  const startMs = Date.now();
  const allDelivered: LogEnvelope[] = [];
  let totalBatches = 0;

  while (true) {
    const leaseRes: LeaseResult = withReaderLock(readerId, () => {
      const { cursor, checksum } = loadCursor(cursorPath, {
        room: roomFlag,
        reader: readerId,
      });
      const res = leaseNext(cursor, logTarget, 50);
      if (res.leaseId !== null && res.messages.length > 0) {
        saveCursorCas(cursorPath, res.cursor, checksum);
      }
      return res;
    });

    if (leaseRes.messages.length > 0) {
      totalBatches += 1;
      for (const msg of leaseRes.messages) {
        allDelivered.push(msg);
      }

      let formattedOutput = "";
      if (jsonFlag) {
        formattedOutput = JSON.stringify(leaseRes.messages) + "\n";
      } else {
        for (const msg of leaseRes.messages) {
          formattedOutput += `[${msg.seq}] <${msg.sender.id}> ${msg.text ?? ""}\n`;
        }
      }

      process.stdout.write(formattedOutput);
    }

    if (timeoutMs > 0 && Date.now() - startMs >= timeoutMs) {
      break;
    }

    if (timeoutMs === 0 && leaseRes.messages.length === 0) {
      break;
    }

    await delay(200);
  }

  return {
    room: roomFlag,
    reader: readerId,
    ack_mode: ackMode,
    batches: totalBatches,
    total_messages: allDelivered.length,
    messages: allDelivered,
  };
};
