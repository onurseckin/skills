import { randomUUID } from "node:crypto";
import {
  appendAtomic,
  canonicalJson,
  ChatError,
  roomAppendLockPath,
  roomLogSegmentPath,
  withLock,
  type Envelope,
  type EnvelopeBody,
  type EnvelopeKind,
  type EnvelopeSender,
  type LogIndex,
  type RoomSettings,
  type UnsignedEnvelope,
} from "../core/index.ts";
import { computeFingerprint, signEnvelope } from "../crypto/index.ts";
import { readRoomKey, readRoomManifest } from "../room/index.ts";
import {
  getHeadSegment,
  readLogIndex,
  rollSegment,
  shouldRollSegment,
  writeLogIndex,
} from "./segments.ts";

export interface AppendMessageInput {
  readonly sender: EnvelopeSender;
  readonly kind: EnvelopeKind;
  readonly thread?: string;
  readonly reply_to?: string | null;
  readonly mentions?: readonly string[];
  readonly text?: string;
  readonly body: EnvelopeBody;
}

export function appendMessage(
  roomId: string,
  message: AppendMessageInput,
  key?: string,
  settingsOverride?: RoomSettings,
): Envelope {
  const manifest = readRoomManifest(roomId);
  const settings = settingsOverride ?? manifest.settings;
  const keyToUse = key ?? readRoomKey(roomId);

  const payloadBytes = Buffer.byteLength(canonicalJson(message.body.data), "utf8");
  if (payloadBytes > settings.max_payload_bytes) {
    throw new ChatError(
      "CAPACITY_EXCEEDED",
      `Payload size ${payloadBytes} bytes exceeds maximum allowed ${settings.max_payload_bytes} bytes`,
    );
  }

  const lockPath = roomAppendLockPath(roomId);

  return withLock(
    lockPath,
    () => {
      let index = readLogIndex(roomId);
      let headSegment = getHeadSegment(index);
      let headSegmentPath = roomLogSegmentPath(roomId, headSegment);

      if (shouldRollSegment(headSegmentPath, settings)) {
        const rolled = rollSegment(roomId, index);
        index = rolled.nextIndex;
        headSegment = rolled.newSegment;
        headSegmentPath = roomLogSegmentPath(roomId, headSegment);
      }

      const seq = index.next_seq;
      const id = randomUUID();
      const ts = new Date().toISOString();
      const keyFingerprint = computeFingerprint(keyToUse);

      const unsigned: UnsignedEnvelope = {
        v: 1,
        id,
        room: roomId,
        seq,
        ts,
        sender: message.sender,
        kind: message.kind,
        ...(message.thread !== undefined ? { thread: message.thread } : {}),
        reply_to: message.reply_to ?? null,
        mentions: message.mentions ?? [],
        ...(message.text !== undefined ? { text: message.text } : {}),
        body: message.body,
        key_fingerprint: keyFingerprint,
      };

      const envelope = signEnvelope(unsigned, keyToUse);
      const line = `${JSON.stringify(envelope)}\n`;

      appendAtomic(headSegmentPath, line);

      const nextIndex: LogIndex = {
        next_seq: seq + 1,
        segments: index.segments,
        head_seq: seq,
        updated_at: ts,
      };

      writeLogIndex(roomId, nextIndex);

      return envelope;
    },
    { holder: `append:${message.sender.id}` },
  );
}
