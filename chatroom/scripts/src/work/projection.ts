import { type Envelope } from "../core/index.ts";
import {
  generateTaskId,
  TASK_ACCEPTED_SCHEMA,
  TASK_NEW_SCHEMA,
  TASK_NOTE_SCHEMA,
  TASK_STATUS_SCHEMA,
  type WorkItem,
  type WorkItemNote,
  type WorkItemStatus,
  type WorkItemType,
} from "./types.ts";

function isValidType(value: unknown): value is WorkItemType {
  return (
    value === "story" ||
    value === "task" ||
    value === "bug" ||
    value === "question" ||
    value === "decision"
  );
}

function isValidStatus(value: unknown): value is WorkItemStatus {
  return (
    value === "open" ||
    value === "in_progress" ||
    value === "blocked" ||
    value === "review" ||
    value === "done" ||
    value === "dropped"
  );
}

function extractString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return undefined;
}

function resolveTargetId(
  data: Readonly<Record<string, unknown>> | undefined,
  envelope: Envelope,
  items: ReadonlyMap<string, WorkItem>,
  envelopeIdToTaskIds: ReadonlyMap<string, ReadonlySet<string>>,
): string | undefined {
  const direct = extractString(data?.id) ?? extractString(data?.task_id);
  if (direct) {
    return direct;
  }
  if (envelope.thread && items.has(envelope.thread)) {
    return envelope.thread;
  }
  if (envelope.reply_to) {
    if (items.has(envelope.reply_to)) {
      return envelope.reply_to;
    }
    const mapped = envelopeIdToTaskIds.get(envelope.reply_to);
    if (mapped && mapped.size > 0) {
      const first = mapped.values().next().value;
      if (first !== undefined) {
        return first;
      }
    }
  }
  return undefined;
}

export function foldWorkItems(envelopes: readonly Envelope[], room: string): Map<string, WorkItem> {
  const items = new Map<string, WorkItem>();
  const envelopeIdToTaskIds = new Map<string, Set<string>>();

  const sorted = [...envelopes].sort((a, b) => a.seq - b.seq);

  for (const envelope of sorted) {
    if (envelope.room !== room) {
      continue;
    }

    const schema = envelope.body?.schema;
    const data = envelope.body?.data;
    const targetIdsForThisEnvelope = new Set<string>();

    if (schema === TASK_NEW_SCHEMA) {
      const explicitId = extractString(data?.id) ?? extractString(data?.task_id);
      const id = explicitId ?? generateTaskId(envelope.seq, envelope.ts);

      if (!items.has(id)) {
        const title = extractString(data?.title) ?? envelope.text ?? "";
        const type: WorkItemType = isValidType(data?.type) ? data.type : "task";
        const status: WorkItemStatus = isValidStatus(data?.status) ? data.status : "open";
        const assignee = extractString(data?.assignee) ?? null;
        const parent = extractString(data?.parent) ?? extractString(data?.parent_id) ?? null;
        const accepted_at = extractString(data?.accepted_at) ?? null;

        const newItem: WorkItem = {
          id,
          room,
          title,
          type,
          status,
          assignee,
          parent,
          created_at: extractString(data?.created_at) ?? envelope.ts,
          updated_at: envelope.ts,
          accepted_at,
          initial_seq: envelope.seq,
          notes: [],
          topic_seqs: [envelope.seq],
        };
        items.set(id, newItem);
      } else {
        const existing = items.get(id)!;
        const updatedTopicSeqs = existing.topic_seqs.includes(envelope.seq)
          ? existing.topic_seqs
          : [...existing.topic_seqs, envelope.seq];
        items.set(id, {
          ...existing,
          topic_seqs: updatedTopicSeqs,
          updated_at: envelope.ts,
        });
      }
      targetIdsForThisEnvelope.add(id);
    } else if (schema === TASK_STATUS_SCHEMA) {
      const targetId = resolveTargetId(data, envelope, items, envelopeIdToTaskIds);
      if (targetId && items.has(targetId)) {
        const existing = items.get(targetId)!;
        const newStatus: WorkItemStatus = isValidStatus(data?.status)
          ? data.status
          : existing.status;
        const updatedTopicSeqs = existing.topic_seqs.includes(envelope.seq)
          ? existing.topic_seqs
          : [...existing.topic_seqs, envelope.seq];
        items.set(targetId, {
          ...existing,
          status: newStatus,
          updated_at: envelope.ts,
          topic_seqs: updatedTopicSeqs,
        });
        targetIdsForThisEnvelope.add(targetId);
      }
    } else if (schema === TASK_NOTE_SCHEMA) {
      const targetId = resolveTargetId(data, envelope, items, envelopeIdToTaskIds);
      if (targetId && items.has(targetId)) {
        const existing = items.get(targetId)!;
        const text = extractString(data?.text) ?? extractString(data?.note) ?? envelope.text ?? "";
        const author = extractString(data?.author) ?? envelope.sender.id;
        const at = extractString(data?.at) ?? envelope.ts;
        const seq = typeof data?.seq === "number" ? data.seq : envelope.seq;
        const note: WorkItemNote = {
          author,
          text,
          at,
          seq,
        };
        const updatedTopicSeqs = existing.topic_seqs.includes(envelope.seq)
          ? existing.topic_seqs
          : [...existing.topic_seqs, envelope.seq];
        items.set(targetId, {
          ...existing,
          notes: [...existing.notes, note],
          updated_at: envelope.ts,
          topic_seqs: updatedTopicSeqs,
        });
        targetIdsForThisEnvelope.add(targetId);
      }
    } else if (schema === TASK_ACCEPTED_SCHEMA) {
      const targetId = resolveTargetId(data, envelope, items, envelopeIdToTaskIds);
      if (targetId && items.has(targetId)) {
        const existing = items.get(targetId)!;
        const accepted_at = extractString(data?.accepted_at) ?? envelope.ts;
        const updatedTopicSeqs = existing.topic_seqs.includes(envelope.seq)
          ? existing.topic_seqs
          : [...existing.topic_seqs, envelope.seq];
        items.set(targetId, {
          ...existing,
          accepted_at,
          updated_at: envelope.ts,
          topic_seqs: updatedTopicSeqs,
        });
        targetIdsForThisEnvelope.add(targetId);
      }
    }

    if (envelope.thread && items.has(envelope.thread)) {
      targetIdsForThisEnvelope.add(envelope.thread);
    }
    if (envelope.reply_to) {
      if (items.has(envelope.reply_to)) {
        targetIdsForThisEnvelope.add(envelope.reply_to);
      }
      const repliedTasks = envelopeIdToTaskIds.get(envelope.reply_to);
      if (repliedTasks) {
        for (const taskId of repliedTasks) {
          targetIdsForThisEnvelope.add(taskId);
        }
      }
    }
    for (const mention of envelope.mentions) {
      if (items.has(mention)) {
        targetIdsForThisEnvelope.add(mention);
      }
    }
    if (envelope.text) {
      for (const taskId of items.keys()) {
        if (envelope.text.includes(taskId)) {
          targetIdsForThisEnvelope.add(taskId);
        }
      }
    }

    for (const taskId of targetIdsForThisEnvelope) {
      const existing = items.get(taskId);
      if (existing && !existing.topic_seqs.includes(envelope.seq)) {
        items.set(taskId, {
          ...existing,
          topic_seqs: [...existing.topic_seqs, envelope.seq],
        });
      }
    }

    if (targetIdsForThisEnvelope.size > 0) {
      envelopeIdToTaskIds.set(envelope.id, targetIdsForThisEnvelope);
    }
  }

  return items;
}
