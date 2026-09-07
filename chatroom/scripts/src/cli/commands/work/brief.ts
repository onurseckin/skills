import {
  assertFlags,
  boolFlag,
  textFlag,
  type CommandContext,
  type CommandHandler,
  type Flags,
} from "../shared/index.ts";
import { assertValidRoomId, ChatError } from "../../../core/index.ts";
import { resolveIdentity } from "../../../identity/index.ts";
import { appendMessage } from "../../../log/index.ts";
import { listRooms } from "../../../room/index.ts";
import {
  BRIEF_SET_SCHEMA,
  extractMemberBrief,
  readRoomLogEnvelopes,
  type ExtendedHealthPorts,
} from "../../../work/index.ts";

export const briefCommand: CommandHandler = async (
  flags: Flags,
  context: CommandContext,
  remainder: readonly string[],
): Promise<Record<string, unknown>> => {
  assertFlags(flags, ["room", "as", "set", "json"]);

  const roomFlag = textFlag(flags, "room", false);
  const asFlag = textFlag(flags, "as", false);
  const setFlag = textFlag(flags, "set", false);
  const jsonFlag = boolFlag(flags, "json");

  let targetRoom = roomFlag;
  if (
    targetRoom === undefined &&
    remainder.length > 0 &&
    remainder[0] !== undefined &&
    remainder[0].trim().length > 0
  ) {
    targetRoom = remainder[0].trim();
  }
  if (targetRoom === undefined) {
    const rooms = listRooms();
    if (rooms.length === 1 && rooms[0] !== undefined) {
      targetRoom = rooms[0].id;
    } else {
      throw new ChatError("INVALID_ARGUMENT", "--room is required");
    }
  }
  assertValidRoomId(targetRoom);

  const identity = resolveIdentity({ as: asFlag, cwd: process.cwd() });
  const memberId = identity.id;

  if (setFlag !== undefined) {
    if (setFlag.trim().length === 0) {
      throw new ChatError("INVALID_ARGUMENT", "--set must not be empty");
    }

    const envelope = appendMessage(targetRoom, {
      sender: {
        id: identity.id,
        role: identity.role,
        host: identity.host,
        ...(identity.repo_hint !== undefined ? { repo_hint: identity.repo_hint } : {}),
        pid: process.pid,
      },
      kind: "message",
      text: setFlag,
      body: {
        schema: BRIEF_SET_SCHEMA,
        data: {
          member_id: memberId,
          text: setFlag,
          updated_at: new Date().toISOString(),
        },
      },
    });

    const bodyData =
      typeof envelope.body === "object" &&
      envelope.body !== null &&
      "data" in envelope.body &&
      typeof (envelope.body as { data: unknown }).data === "object" &&
      (envelope.body as { data: unknown }).data !== null
        ? (envelope.body as { data: Record<string, unknown> }).data
        : undefined;

    const updatedAt =
      typeof bodyData?.["updated_at"] === "string" ? bodyData["updated_at"] : envelope.ts;

    const result: Record<string, unknown> = {
      room: targetRoom,
      member: memberId,
      member_id: memberId,
      as: memberId,
      text: setFlag,
      seq: envelope.seq,
      updated_at: updatedAt,
      ok: true,
      receipt: {
        id: envelope.id,
        seq: envelope.seq,
        ts: envelope.ts,
      },
    };

    if (!jsonFlag) {
      process.stdout.write(
        `Updated recovery brief for '${memberId}' in room '${targetRoom}' (seq: ${envelope.seq})\n`,
      );
    }

    return result;
  }

  const ports = (context as { ports?: ExtendedHealthPorts })?.ports;
  const envelopes = readRoomLogEnvelopes(targetRoom, ports);
  const brief = extractMemberBrief(envelopes, memberId);

  if (brief !== null) {
    const result: Record<string, unknown> = {
      room: targetRoom,
      member: memberId,
      member_id: memberId,
      as: memberId,
      text: brief.text,
      updated_at: brief.updated_at,
      seq: brief.seq,
      exists: true,
    };

    if (!jsonFlag) {
      process.stdout.write(`${brief.text}\n`);
    }

    return result;
  }

  const message = `No recovery brief set for ${memberId} in room ${targetRoom}.`;

  if (!jsonFlag) {
    process.stdout.write(`${message}\n`);
  }

  return {
    room: targetRoom,
    member: memberId,
    member_id: memberId,
    as: memberId,
    text: null,
    updated_at: null,
    seq: null,
    exists: false,
    message,
  };
};
