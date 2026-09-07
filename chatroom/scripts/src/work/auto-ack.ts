import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  appendAtomic,
  roomKeyPath,
  roomLogIndexPath,
  roomLogSegmentPath,
  writeAtomic,
  type Envelope,
  type UnsignedEnvelope,
} from "../core/index.ts";
import { CHATROOM_PUBLIC_KEY, computeFingerprint, signEnvelope } from "../crypto/index.ts";
import { type HealthPorts } from "../daemon/index.ts";

function getAssignee(envelope: Envelope): string | undefined {
  const data = envelope.body?.data;
  if (data !== null && typeof data === "object") {
    const rawAssignee = (data as Record<string, unknown>)["assignee"];
    if (typeof rawAssignee === "string") {
      return rawAssignee;
    }
  }
  const candidate = (envelope as unknown as Record<string, unknown>)["assignee"];
  if (typeof candidate === "string") {
    return candidate;
  }
  return undefined;
}

function getTaskId(envelope: Envelope): string {
  const data = envelope.body?.data;
  if (data !== null && typeof data === "object") {
    const rawTaskId = (data as Record<string, unknown>)["task_id"];
    if (typeof rawTaskId === "string" && rawTaskId.length > 0) {
      return rawTaskId;
    }
    const rawId = (data as Record<string, unknown>)["id"];
    if (typeof rawId === "string" && rawId.length > 0) {
      return rawId;
    }
  }
  return envelope.id;
}

function getExistingAcceptedAt(envelope: Envelope): string | undefined {
  const data = envelope.body?.data;
  if (data !== null && typeof data === "object") {
    const raw = (data as Record<string, unknown>)["accepted_at"];
    if (typeof raw === "string" && raw.length > 0) {
      return raw;
    }
  }
  return undefined;
}

function isMatchingTask(envelope: Envelope, readerId: string): boolean {
  if (envelope.body?.schema !== "chatroom.task.new.v1") {
    return false;
  }
  return getAssignee(envelope) === readerId;
}

function resolveKey(room: string, ports?: HealthPorts): string {
  const existsFn = ports?.existsSync ?? existsSync;
  const readFn = ports?.readFileSync ?? readFileSync;
  try {
    const keyPath = roomKeyPath(room);
    if (existsFn(keyPath)) {
      return readFn(keyPath, "utf8").trim();
    }
  } catch {}
  return CHATROOM_PUBLIC_KEY;
}

function readLogEnvelopes(room: string, ports?: HealthPorts): readonly Envelope[] {
  const existsFn = ports?.existsSync ?? existsSync;
  const readFn = ports?.readFileSync ?? readFileSync;

  const indexPath = roomLogIndexPath(room);
  const segmentFiles: string[] = [];

  if (existsFn(indexPath)) {
    try {
      const raw = readFn(indexPath, "utf8");
      const parsed = JSON.parse(raw) as { readonly segments?: readonly string[] };
      if (Array.isArray(parsed.segments)) {
        for (const seg of parsed.segments) {
          if (typeof seg === "string") {
            segmentFiles.push(roomLogSegmentPath(room, seg));
          }
        }
      }
    } catch {}
  }

  if (segmentFiles.length === 0) {
    const defaultHead = roomLogSegmentPath(room, "000001.jsonl");
    if (existsFn(defaultHead)) {
      segmentFiles.push(defaultHead);
    }
  }

  const envelopes: Envelope[] = [];
  for (const segPath of segmentFiles) {
    if (!existsFn(segPath)) {
      continue;
    }
    try {
      const content = readFn(segPath, "utf8");
      const lines = content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
          continue;
        }
        const parsed = JSON.parse(trimmed) as Envelope;
        if (parsed && typeof parsed === "object" && "body" in parsed) {
          envelopes.push(parsed);
        }
      }
    } catch {}
  }
  return envelopes;
}

function isAcceptedInLog(
  room: string,
  taskId: string,
  targetEnvelopeId: string,
  ports?: HealthPorts,
): { readonly accepted: boolean; readonly acceptedAt?: string } {
  const envelopes = readLogEnvelopes(room, ports);
  for (const env of envelopes) {
    if (env.body?.schema === "chatroom.task.accepted.v1") {
      const data = env.body.data as Record<string, unknown> | undefined;
      const tid = data?.["task_id"] ?? data?.["id"];
      if (
        tid === taskId ||
        env.reply_to === targetEnvelopeId ||
        env.reply_to === taskId ||
        env.id === taskId
      ) {
        const acceptedAt = typeof data?.["accepted_at"] === "string" ? data["accepted_at"] : env.ts;
        return { accepted: true, acceptedAt };
      }
    }
  }
  return { accepted: false };
}

function appendAcceptedEnvelope(
  room: string,
  readerId: string,
  targetEnvelope: Envelope,
  taskId: string,
  nowIso: string,
  ports?: HealthPorts,
): Envelope {
  const existsFn = ports?.existsSync ?? existsSync;
  const readFn = ports?.readFileSync ?? readFileSync;
  const writeFn = ports?.writeAtomic ?? ports?.writeFileSync;

  const existingEnvelopes = readLogEnvelopes(room, ports);
  let nextSeq = 1;
  for (const env of existingEnvelopes) {
    if (typeof env.seq === "number" && env.seq >= nextSeq) {
      nextSeq = env.seq + 1;
    }
  }
  if (targetEnvelope.seq >= nextSeq) {
    nextSeq = targetEnvelope.seq + 1;
  }

  const indexPath = roomLogIndexPath(room);
  let headSegmentName = "000001.jsonl";
  let segmentsList: string[] = [headSegmentName];

  if (existsFn(indexPath)) {
    try {
      const raw = readFn(indexPath, "utf8");
      const parsed = JSON.parse(raw) as {
        readonly next_seq?: number;
        readonly segments?: readonly string[];
        readonly head_seq?: number;
      };
      if (typeof parsed.next_seq === "number" && parsed.next_seq > nextSeq) {
        nextSeq = parsed.next_seq;
      }
      if (Array.isArray(parsed.segments) && parsed.segments.length > 0) {
        segmentsList = [...parsed.segments];
        const lastSeg = segmentsList[segmentsList.length - 1];
        if (lastSeg !== undefined) {
          headSegmentName = lastSeg;
        }
      }
    } catch {}
  }

  const keyToUse = resolveKey(room, ports);
  const keyFingerprint = computeFingerprint(keyToUse);

  const acceptedData: Record<string, unknown> = {
    task_id: taskId,
    assignee: readerId,
    accepted_at: nowIso,
  };
  if (typeof targetEnvelope.body?.data?.["id"] === "string") {
    acceptedData["id"] = targetEnvelope.body.data["id"];
  }

  const unsigned: UnsignedEnvelope = {
    v: 1,
    id: randomUUID(),
    room,
    seq: nextSeq,
    ts: nowIso,
    sender: {
      id: readerId,
      role: "agent",
      host: "localhost",
    },
    kind: "message",
    reply_to: targetEnvelope.id,
    mentions: [targetEnvelope.sender.id],
    text: `Task ${taskId} accepted by ${readerId}`,
    body: {
      schema: "chatroom.task.accepted.v1",
      data: acceptedData,
    },
    key_fingerprint: keyFingerprint,
  };

  const signed = signEnvelope(unsigned, keyToUse);
  const line = `${JSON.stringify(signed)}\n`;
  const headSegmentPath = roomLogSegmentPath(room, headSegmentName);

  const updatedIndex = {
    next_seq: nextSeq + 1,
    segments: segmentsList,
    head_seq: nextSeq,
    updated_at: nowIso,
  };

  if (writeFn) {
    let prevContent = "";
    if (existsFn(headSegmentPath)) {
      try {
        prevContent = readFn(headSegmentPath, "utf8");
      } catch {
        prevContent = "";
      }
    }
    writeFn(headSegmentPath, prevContent + line);
    writeFn(indexPath, JSON.stringify(updatedIndex, null, 2));
  } else {
    appendAtomic(headSegmentPath, line);
    writeAtomic(indexPath, JSON.stringify(updatedIndex, null, 2));
  }

  return signed;
}

function withAcceptedAt(envelope: Envelope, acceptedAt: string): Envelope {
  const currentData = (envelope.body?.data as Record<string, unknown> | undefined) ?? {};
  return {
    ...envelope,
    body: {
      ...envelope.body,
      data: {
        ...currentData,
        accepted_at: acceptedAt,
      },
    },
  };
}

export function processAutoAcknowledge(
  room: string,
  readerId: string,
  envelopes: readonly Envelope[],
  ports?: HealthPorts,
): readonly Envelope[] {
  const acceptedInBatch = new Map<string, string>();

  return envelopes.map((envelope) => {
    if (!isMatchingTask(envelope, readerId)) {
      return envelope;
    }

    const taskId = getTaskId(envelope);
    const existingAcceptedAt = getExistingAcceptedAt(envelope);
    if (existingAcceptedAt !== undefined) {
      return envelope;
    }

    const inBatchAcceptedAt = acceptedInBatch.get(taskId);
    if (inBatchAcceptedAt !== undefined) {
      return withAcceptedAt(envelope, inBatchAcceptedAt);
    }

    const logCheck = isAcceptedInLog(room, taskId, envelope.id, ports);
    if (logCheck.accepted && logCheck.acceptedAt !== undefined) {
      acceptedInBatch.set(taskId, logCheck.acceptedAt);
      return withAcceptedAt(envelope, logCheck.acceptedAt);
    }

    const nowIso = new Date().toISOString();
    appendAcceptedEnvelope(room, readerId, envelope, taskId, nowIso, ports);
    acceptedInBatch.set(taskId, nowIso);
    return withAcceptedAt(envelope, nowIso);
  });
}
