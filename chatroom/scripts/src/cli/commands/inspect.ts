import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
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
  roomDir,
  roomLogDir,
  roomLogIndexPath,
  roomLogSegmentPath,
  type Envelope,
} from "../../core/index.ts";
import { parseSegmentNumber, readLogIndex, readSegmentEnvelopes } from "../../log/index.ts";

function getSegmentPaths(roomId: string): readonly string[] {
  const logDir = roomLogDir(roomId);
  if (existsSync(logDir)) {
    const files = readdirSync(logDir)
      .filter((file) => file.endsWith(".jsonl"))
      .sort((a, b) => parseSegmentNumber(a) - parseSegmentNumber(b));
    if (files.length > 0) {
      return files.map((file) => join(logDir, file));
    }
  }

  const indexPath = roomLogIndexPath(roomId);
  if (existsSync(indexPath)) {
    const index = readLogIndex(roomId);
    return index.segments.map((seg) => roomLogSegmentPath(roomId, seg));
  }

  if (!existsSync(roomDir(roomId))) {
    throw new ChatError("UNKNOWN_ROOM", `Room '${roomId}' not found`);
  }

  return [];
}

export const inspectCommand: CommandHandler = async (
  flags: Flags,
  _context: CommandContext,
  _remainder: readonly string[],
): Promise<Record<string, unknown>> => {
  assertFlags(flags, ["room", "since", "type", "limit", "json"]);

  const roomFlag = textFlag(flags, "room", true);
  if (roomFlag === undefined) {
    throw new ChatError("INVALID_ARGUMENT", "--room is required");
  }
  assertValidRoomId(roomFlag);

  const sinceFlag = intFlag(flags, "since", { minimum: 0 });
  const typeFlag = textFlag(flags, "type", false);
  const limitFlag = intFlag(flags, "limit", { minimum: 1 });
  const jsonFlag = boolFlag(flags, "json");

  const limit = limitFlag !== undefined ? limitFlag : 50;

  const segmentPaths = getSegmentPaths(roomFlag);
  const matched: Envelope[] = [];

  for (const segmentPath of segmentPaths) {
    const { envelopes } = readSegmentEnvelopes(segmentPath);
    for (const envelope of envelopes) {
      if (sinceFlag !== undefined && envelope.seq < sinceFlag) {
        continue;
      }
      if (
        typeFlag !== undefined &&
        envelope.kind !== typeFlag &&
        envelope.body?.schema !== typeFlag
      ) {
        continue;
      }
      matched.push(envelope);
      if (matched.length >= limit) {
        break;
      }
    }
    if (matched.length >= limit) {
      break;
    }
  }

  const result: Record<string, unknown> = {
    room: roomFlag,
    count: matched.length,
    envelopes: matched,
    messages: matched,
  };

  if (!jsonFlag) {
    for (const msg of matched) {
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
      process.stdout.write(`[${msg.seq}] <${msg.sender.id}> ${displayText ?? ""}\n`);
    }
  }

  return result;
};
