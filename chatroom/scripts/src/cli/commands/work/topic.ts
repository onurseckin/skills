import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  assertFlags,
  boolFlag,
  textFlag,
  type CommandContext,
  type CommandHandler,
  type Flags,
} from "../shared/index.ts";
import {
  assertValidRoomId,
  ChatError,
  roomDir,
  roomLogDir,
  roomLogIndexPath,
  roomLogSegmentPath,
  type Envelope,
} from "../../../core/index.ts";
import { parseSegmentNumber, readLogIndex, readSegmentEnvelopes } from "../../../log/index.ts";
import { assertMember } from "../../../room/index.ts";
import { resolveIdentity } from "../../../identity/index.ts";

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

function envelopeMatchesTopic(envelope: Envelope, topicId: string): boolean {
  if (envelope.thread === topicId) {
    return true;
  }
  if (envelope.id === topicId) {
    return true;
  }
  if (envelope.reply_to === topicId) {
    return true;
  }
  const bodyData =
    typeof envelope.body === "object" &&
    envelope.body !== null &&
    "data" in envelope.body &&
    typeof (envelope.body as { data: unknown }).data === "object" &&
    (envelope.body as { data: unknown }).data !== null
      ? (envelope.body as { data: Record<string, unknown> }).data
      : undefined;
  if (bodyData !== undefined) {
    if (
      bodyData["task_id"] === topicId ||
      bodyData["id"] === topicId ||
      bodyData["topic"] === topicId
    ) {
      return true;
    }
  }
  return false;
}

export const topicCommand: CommandHandler = async (
  flags: Flags,
  _context: CommandContext,
  remainder: readonly string[],
): Promise<Record<string, unknown>> => {
  assertFlags(flags, ["room", "json", "as"]);

  const roomFlag = textFlag(flags, "room", true);
  if (roomFlag === undefined) {
    throw new ChatError("INVALID_ARGUMENT", "--room is required");
  }
  assertValidRoomId(roomFlag);

  const asFlag = textFlag(flags, "as", false);
  if (asFlag !== undefined) {
    const identity = resolveIdentity({ as: asFlag, cwd: process.cwd() });
    assertMember(roomFlag, identity);
  }

  const jsonFlag = boolFlag(flags, "json");

  const topicId = remainder[0]?.trim();
  if (topicId === undefined || topicId.length === 0) {
    throw new ChatError("INVALID_ARGUMENT", "Topic id is required as positional argument");
  }

  const segmentPaths = getSegmentPaths(roomFlag);
  const matched: Envelope[] = [];

  for (const segmentPath of segmentPaths) {
    const { envelopes } = readSegmentEnvelopes(segmentPath);
    for (const envelope of envelopes) {
      if (envelopeMatchesTopic(envelope, topicId)) {
        matched.push(envelope);
      }
    }
  }

  matched.sort((a, b) => a.seq - b.seq);

  const result: Record<string, unknown> = {
    room: roomFlag,
    topic: topicId,
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
        typeof bodyData?.["text"] === "string"
          ? (bodyData["text"] as string)
          : typeof bodyData?.["note"] === "string"
            ? (bodyData["note"] as string)
            : undefined;
      const displayText = msg.text ?? bodyText ?? "";
      process.stdout.write(`[${msg.seq}] <${msg.sender.id}> ${displayText}\n`);
    }
  }

  return result;
};
