import * as fs from "node:fs";
import {
  assertFlags,
  boolFlag,
  listFlag,
  textFlag,
  type CommandContext,
  type CommandHandler,
  type Flags,
} from "./shared/index.ts";
import {
  assertValidRoomId,
  ChatError,
  isEnvelopeKind,
  type EnvelopeKind,
} from "../../core/index.ts";
import { assertMember, resolveMention } from "../../room/index.ts";
import { resolveIdentity } from "../../identity/index.ts";
import { appendMessage } from "../../log/index.ts";
import { ensureDaemon } from "../../daemon/index.ts";

export const sayCommand: CommandHandler = async (
  flags: Flags,
  context: CommandContext,
  _remainder: readonly string[],
): Promise<Record<string, unknown>> => {
  assertFlags(flags, [
    "room",
    "as",
    "text",
    "payload",
    "payload-file",
    "schema",
    "kind",
    "to",
    "thread",
    "reply-to",
    "json",
  ]);

  const roomFlag = textFlag(flags, "room", true);
  if (roomFlag === undefined) {
    throw new ChatError("INVALID_ARGUMENT", "--room is required");
  }
  assertValidRoomId(roomFlag);

  const asFlag = textFlag(flags, "as", false);
  const textFlagVal = textFlag(flags, "text", false);
  const payloadFlag = textFlag(flags, "payload", false);
  const payloadFileFlag = textFlag(flags, "payload-file", false);
  const schemaFlag = textFlag(flags, "schema", false);
  const kindFlag = textFlag(flags, "kind", false);
  const toFlag = listFlag(flags, "to", false);
  const threadFlag = textFlag(flags, "thread", false);
  const replyToFlag = textFlag(flags, "reply-to", false);
  const jsonFlag = boolFlag(flags, "json");

  const identity = resolveIdentity({ as: asFlag, cwd: process.cwd() });

  assertMember(roomFlag, identity);

  try {
    ensureDaemon(roomFlag, identity.id);
  } catch {}

  const mentions: string[] = [];
  if (toFlag !== undefined) {
    for (const mention of toFlag) {
      const memberRec = resolveMention(roomFlag, mention);
      mentions.push(memberRec.id);
    }
  }

  let text = textFlagVal;
  let payloadData: Record<string, unknown> | undefined = undefined;

  if (payloadFlag !== undefined) {
    try {
      const parsed: unknown = JSON.parse(payloadFlag);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        if (schemaFlag === "chatroom.text.v1" || schemaFlag === undefined) {
          payloadData = { text: String(parsed) };
        } else {
          throw new ChatError("INVALID_PAYLOAD", "--payload must be a JSON object");
        }
      } else {
        payloadData = parsed as Record<string, unknown>;
      }
    } catch (err) {
      if (err instanceof ChatError) throw err;
      throw new ChatError("INVALID_PAYLOAD", `Failed to parse --payload JSON: ${String(err)}`);
    }
  } else if (payloadFileFlag !== undefined) {
    if (!fs.existsSync(payloadFileFlag)) {
      throw new ChatError("NOT_FOUND", `Payload file '${payloadFileFlag}' not found`);
    }
    try {
      const raw = fs.readFileSync(payloadFileFlag, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new ChatError("INVALID_PAYLOAD", "--payload-file must contain a JSON object");
      }
      payloadData = parsed as Record<string, unknown>;
    } catch (err) {
      if (err instanceof ChatError) throw err;
      throw new ChatError("INVALID_PAYLOAD", `Failed to parse payload file JSON: ${String(err)}`);
    }
  } else if (context.stdin !== undefined && context.stdin.length > 0) {
    const stdinStr = Buffer.from(context.stdin).toString("utf8").trim();
    if (stdinStr.length > 0) {
      try {
        const parsed: unknown = JSON.parse(stdinStr);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          payloadData = parsed as Record<string, unknown>;
        } else if (text === undefined) {
          text = stdinStr;
        }
      } catch {
        if (text === undefined) {
          text = stdinStr;
        }
      }
    }
  }

  if (text === undefined && payloadData === undefined) {
    throw new ChatError(
      "INVALID_ARGUMENT",
      "At least one of --text, --payload, --payload-file, or stdin is required",
    );
  }

  const schema = schemaFlag !== undefined ? schemaFlag : "chatroom.text.v1";
  const finalData = payloadData !== undefined ? payloadData : { text: text ?? "" };
  const kind = (
    kindFlag !== undefined && isEnvelopeKind(kindFlag) ? kindFlag : "message"
  ) as EnvelopeKind;

  const payloadText =
    payloadData !== undefined && typeof payloadData["text"] === "string"
      ? (payloadData["text"] as string)
      : undefined;
  const resolvedText = text !== undefined ? text : payloadText;

  const envelope = appendMessage(roomFlag, {
    sender: {
      id: identity.id,
      role: identity.role,
      host: identity.host,
      ...(identity.repo_hint !== undefined ? { repo_hint: identity.repo_hint } : {}),
      pid: process.pid,
    },
    kind,
    ...(threadFlag !== undefined ? { thread: threadFlag } : {}),
    ...(replyToFlag !== undefined ? { reply_to: replyToFlag } : {}),
    ...(mentions.length > 0 ? { mentions } : {}),
    ...(resolvedText !== undefined ? { text: resolvedText } : {}),
    body: {
      schema,
      data: finalData,
    },
  });

  const result: Record<string, unknown> = {
    envelope,
    id: envelope.id,
    seq: envelope.seq,
    room: roomFlag,
  };

  if (!jsonFlag) {
    process.stdout.write(`Message ${envelope.seq} sent (id: ${envelope.id})\n`);
  }

  return result;
};
