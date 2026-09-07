import {
  assertFlags,
  boolFlag,
  textFlag,
  type CommandContext,
  type CommandHandler,
  type Flags,
} from "../shared/index.ts";
import { assertValidRoomId, ChatError, type Envelope } from "../../../core/index.ts";
import { assertMember, resolveMention } from "../../../room/index.ts";
import { resolveIdentity } from "../../../identity/index.ts";
import { appendMessage, readLogIndex } from "../../../log/index.ts";
import { generateTaskId } from "../../../work/index.ts";
import { ensureDaemon } from "../../../daemon/index.ts";

const VALID_TASK_TYPES = new Set(["story", "task", "bug", "question", "decision"]);

export const taskCommand: CommandHandler = async (
  flags: Flags,
  _context: CommandContext,
  remainder: readonly string[],
): Promise<Record<string, unknown>> => {
  assertFlags(flags, ["room", "new", "type", "to", "parent", "note", "as", "json"]);

  const roomFlag = textFlag(flags, "room", true);
  if (roomFlag === undefined) {
    throw new ChatError("INVALID_ARGUMENT", "--room is required");
  }
  assertValidRoomId(roomFlag);

  const newFlag = textFlag(flags, "new", false);
  const typeFlag = textFlag(flags, "type", false);
  const toFlag = textFlag(flags, "to", false);
  const parentFlag = textFlag(flags, "parent", false);
  const noteFlag = textFlag(flags, "note", false);
  const asFlag = textFlag(flags, "as", false);
  const jsonFlag = boolFlag(flags, "json");

  if (typeFlag !== undefined && !VALID_TASK_TYPES.has(typeFlag)) {
    throw new ChatError(
      "INVALID_ARGUMENT",
      `Invalid task type '${typeFlag}'; must be one of: story, task, bug, question, decision`,
    );
  }

  const identity = resolveIdentity({ as: asFlag, cwd: process.cwd() });
  assertMember(roomFlag, identity);

  try {
    ensureDaemon(roomFlag, identity.id);
  } catch {}

  let assignee: string | undefined;
  const mentions: string[] = [];
  if (toFlag !== undefined) {
    let memberId = toFlag.startsWith("@") ? toFlag.slice(1) : toFlag;
    try {
      const member = resolveMention(roomFlag, toFlag);
      memberId = member.id;
    } catch {}
    assignee = memberId;
    mentions.push(memberId);
  }

  if (newFlag !== undefined) {
    if (noteFlag !== undefined) {
      throw new ChatError("INVALID_ARGUMENT", "Cannot combine --new with --note");
    }
    if (remainder.length >= 2) {
      throw new ChatError("INVALID_ARGUMENT", "Cannot combine --new with status transition");
    }
    const taskType = typeFlag ?? "task";
    let taskId: string;
    let now: string | undefined;
    if (remainder.length >= 1 && remainder[0] !== undefined && remainder[0].trim().length > 0) {
      taskId = remainder[0].trim();
    } else {
      const index = readLogIndex(roomFlag);
      now = new Date().toISOString();
      taskId = generateTaskId(index.next_seq, now);
    }
    const title = newFlag;
    const payloadData: Record<string, unknown> = {
      id: taskId,
      task_id: taskId,
      title,
      type: taskType,
      status: "open",
      ...(assignee !== undefined ? { to: assignee, assignee } : {}),
      ...(parentFlag !== undefined ? { parent: parentFlag } : {}),
    };
    const summaryText = `[${taskType.toUpperCase()}] ${title} (${taskId})`;
    const envelope: Envelope = appendMessage(roomFlag, {
      sender: {
        id: identity.id,
        role: identity.role,
        host: identity.host,
        ...(identity.repo_hint !== undefined ? { repo_hint: identity.repo_hint } : {}),
        pid: process.pid,
      },
      kind: "message",
      thread: taskId,
      ...(mentions.length > 0 ? { mentions } : {}),
      text: summaryText,
      ...(now !== undefined ? { ts: now } : {}),
      body: {
        schema: "chatroom.task.new.v1",
        data: payloadData,
      },
    });
    if (!jsonFlag) {
      process.stdout.write(`Task ${taskId} created: ${title} (seq: ${envelope.seq})\n`);
    }
    return {
      room: roomFlag,
      id: taskId,
      task_id: taskId,
      seq: envelope.seq,
      envelope,
    };
  }

  if (noteFlag !== undefined) {
    const taskId =
      remainder.length >= 1 && remainder[0] !== undefined && remainder[0].trim().length > 0
        ? remainder[0].trim()
        : parentFlag;
    if (taskId === undefined || taskId.trim().length === 0) {
      throw new ChatError("INVALID_ARGUMENT", "Task id is required for --note");
    }
    const noteText = noteFlag;
    const payloadData: Record<string, unknown> = {
      id: taskId,
      task_id: taskId,
      note: noteText,
      text: noteText,
      ...(assignee !== undefined ? { to: assignee, assignee } : {}),
      ...(parentFlag !== undefined ? { parent: parentFlag } : {}),
    };
    const envelope: Envelope = appendMessage(roomFlag, {
      sender: {
        id: identity.id,
        role: identity.role,
        host: identity.host,
        ...(identity.repo_hint !== undefined ? { repo_hint: identity.repo_hint } : {}),
        pid: process.pid,
      },
      kind: "message",
      thread: taskId,
      ...(mentions.length > 0 ? { mentions } : {}),
      text: noteText,
      body: {
        schema: "chatroom.task.note.v1",
        data: payloadData,
      },
    });
    if (!jsonFlag) {
      process.stdout.write(`Task ${taskId} note added (seq: ${envelope.seq})\n`);
    }
    return {
      room: roomFlag,
      id: taskId,
      task_id: taskId,
      seq: envelope.seq,
      envelope,
    };
  }

  if (remainder.length >= 2) {
    const taskId = remainder[0]!.trim();
    const status = remainder[1]!.trim();
    if (taskId.length === 0) {
      throw new ChatError("INVALID_ARGUMENT", "Task id cannot be empty");
    }
    if (status.length === 0) {
      throw new ChatError("INVALID_ARGUMENT", "Status cannot be empty");
    }
    if (/^\d+$/.test(status)) {
      throw new ChatError("INVALID_ARGUMENT", "Status must be a state name, not a sequence number");
    }
    const summaryText = `Task ${taskId} status changed to ${status}`;
    const payloadData: Record<string, unknown> = {
      id: taskId,
      task_id: taskId,
      status,
      ...(assignee !== undefined ? { to: assignee, assignee } : {}),
      ...(parentFlag !== undefined ? { parent: parentFlag } : {}),
    };
    const envelope: Envelope = appendMessage(roomFlag, {
      sender: {
        id: identity.id,
        role: identity.role,
        host: identity.host,
        ...(identity.repo_hint !== undefined ? { repo_hint: identity.repo_hint } : {}),
        pid: process.pid,
      },
      kind: "message",
      thread: taskId,
      ...(mentions.length > 0 ? { mentions } : {}),
      text: summaryText,
      body: {
        schema: "chatroom.task.status.v1",
        data: payloadData,
      },
    });
    if (!jsonFlag) {
      process.stdout.write(`Task ${taskId} status -> ${status} (seq: ${envelope.seq})\n`);
    }
    return {
      room: roomFlag,
      id: taskId,
      task_id: taskId,
      seq: envelope.seq,
      envelope,
    };
  }

  throw new ChatError(
    "INVALID_ARGUMENT",
    "Specify --new <title>, --note <comment>, or provide '<id> <status>' positional arguments",
  );
};
