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
  readerCursorPath,
  readerSpoolCursorPath,
  roomLogDir,
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
  type LogEnvelope,
} from "../../cursor/index.ts";
import { ensureDaemon } from "../../daemon/index.ts";

let stdoutPoisoned = false;
let errorHandlerInstalled = false;

function ensureStdoutHandlers(): void {
  if (errorHandlerInstalled) return;
  errorHandlerInstalled = true;
  process.stdout.on("error", () => {
    stdoutPoisoned = true;
  });
  process.stdout.on("close", () => {
    stdoutPoisoned = true;
  });
}

function writeFlushed(
  stream: NodeJS.WritableStream,
  chunk: string,
): Promise<{ readonly success: boolean; readonly bytes: number }> {
  ensureStdoutHandlers();
  if (stdoutPoisoned) {
    return Promise.resolve({ success: false, bytes: 0 });
  }

  const expectedBytes = Buffer.byteLength(chunk, "utf8");

  return new Promise((resolve) => {
    let callbackFiredNoError = false;
    let drainObserved = false;
    let returnVal = true;

    const onDrain = () => {
      drainObserved = true;
      checkComplete();
    };

    const checkComplete = () => {
      if (stdoutPoisoned) {
        stream.removeListener("drain", onDrain);
        resolve({ success: false, bytes: 0 });
        return;
      }
      const drainSatisfied = returnVal ? true : drainObserved;
      if (callbackFiredNoError && drainSatisfied) {
        stream.removeListener("drain", onDrain);
        resolve({ success: true, bytes: expectedBytes });
      }
    };

    returnVal = stream.write(chunk, (err) => {
      if (err) {
        stdoutPoisoned = true;
        stream.removeListener("drain", onDrain);
        resolve({ success: false, bytes: 0 });
        return;
      }
      callbackFiredNoError = true;
      checkComplete();
    });

    if (!returnVal) {
      stream.once("drain", onDrain);
    }
  });
}

export const watchCommand: CommandHandler = async (
  flags: Flags,
  _context: CommandContext,
  _remainder: readonly string[],
): Promise<Record<string, unknown>> => {
  assertFlags(flags, ["room", "as", "reader", "ack-mode", "timeout", "json"]);

  const roomFlag = textFlag(flags, "room", true);
  if (roomFlag === undefined) {
    throw new ChatError("INVALID_ARGUMENT", "--room is required");
  }
  assertValidRoomId(roomFlag);

  const asFlag = textFlag(flags, "as", false);
  const readerFlag = textFlag(flags, "reader", false);
  const ackModeFlag = textFlag(flags, "ack-mode", false);
  const timeoutFlag = intFlag(flags, "timeout", { minimum: 0 });
  const jsonFlag = boolFlag(flags, "json");

  const ackMode = ackModeFlag !== undefined ? ackModeFlag : "explicit";
  if (ackMode !== "explicit" && ackMode !== "flushed") {
    throw new ChatError(
      "INVALID_ARGUMENT",
      `--ack-mode must be 'explicit' or 'flushed', got '${ackMode}'`,
    );
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

      if (ackMode === "flushed" && leaseRes.leaseId !== null) {
        const writeResult = await writeFlushed(process.stdout, formattedOutput);
        if (writeResult.success && !stdoutPoisoned) {
          const confirmation: Confirmation = {
            kind: "flushed",
            at: new Date().toISOString(),
            bytes: writeResult.bytes,
            drained: true,
          };
          const leaseId = leaseRes.leaseId;
          withReaderLock(readerId, () => {
            const { cursor, checksum } = loadCursor(cursorPath, {
              room: roomFlag,
              reader: readerId,
            });
            const updated = ackLease(cursor, leaseId, null, confirmation);
            saveCursorCas(cursorPath, updated, checksum);
          });
        }
      } else {
        process.stdout.write(formattedOutput);
      }
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
