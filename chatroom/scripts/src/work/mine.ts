import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  daemonHealthPath,
  isEnvelope,
  roomLogIndexPath,
  roomLogSegmentPath,
  roomsDir,
  type Envelope,
} from "../core/index.ts";
import { readHealthRecord, type HealthPorts } from "../daemon/index.ts";
import { replayWorkItems } from "./store.ts";
import type { WorkItem as BaseWorkItem, WorkItemStatus } from "./types.ts";

export type { WorkItemStatus } from "./types.ts";

export interface WorkItem extends BaseWorkItem {
  readonly last_thread_message: string | null;
}

export interface MineRecoveryReport {
  readonly identity: string;
  readonly items_by_status: Record<string, WorkItem[]>;
  readonly unseen: WorkItem[];
  readonly total_open: number;
}

export interface ExtendedHealthPorts extends HealthPorts {
  readonly readdirSync?: (path: string) => string[] | { name: string; isDirectory(): boolean }[];
  readonly statSync?: (path: string) => { isDirectory(): boolean };
}

function listRoomIds(root: string, ports?: HealthPorts): readonly string[] {
  const existsFn = ports?.existsSync ?? existsSync;
  if (!existsFn(root)) {
    return [];
  }
  const ext = ports as ExtendedHealthPorts | undefined;
  const readDirFn = ext?.readdirSync ?? readdirSync;
  try {
    const rawEntries = readDirFn(root);
    const names: string[] = [];
    for (const entry of rawEntries) {
      const name = typeof entry === "string" ? entry : entry.name;
      if (!name || name.startsWith(".")) {
        continue;
      }
      const roomPath = join(root, name);
      const isDir =
        existsFn(join(roomPath, "room.json")) ||
        existsFn(join(roomPath, "log")) ||
        existsFn(join(roomPath, "log.index.json")) ||
        existsFn(join(roomPath, "work.cache.json")) ||
        ext?.statSync?.(roomPath)?.isDirectory() ||
        (() => {
          try {
            return statSync(roomPath).isDirectory();
          } catch {
            return false;
          }
        })();
      if (isDir) {
        names.push(name);
      }
    }
    return names.sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

function readAllEnvelopesForRoom(room: string, ports?: HealthPorts): readonly Envelope[] {
  const existsFn = ports?.existsSync ?? existsSync;
  const readFn = ports?.readFileSync ?? readFileSync;

  const indexPath = roomLogIndexPath(room);
  const segments: string[] = [];

  if (existsFn(indexPath)) {
    try {
      const content = readFn(indexPath, "utf8");
      const parsed: unknown = JSON.parse(content);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "segments" in parsed &&
        Array.isArray((parsed as { segments: unknown }).segments)
      ) {
        for (const seg of (parsed as { segments: readonly unknown[] }).segments) {
          if (typeof seg === "string") {
            segments.push(seg);
          }
        }
      }
    } catch {}
  }

  if (segments.length === 0) {
    let segNum = 1;
    while (true) {
      const segName = `${String(segNum).padStart(6, "0")}.jsonl`;
      const segPath = roomLogSegmentPath(room, segName);
      if (!existsFn(segPath)) {
        break;
      }
      segments.push(segName);
      segNum++;
    }
  }

  const envelopes: Envelope[] = [];
  for (const segName of segments) {
    const segPath = roomLogSegmentPath(room, segName);
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
        const parsed: unknown = JSON.parse(trimmed);
        if (isEnvelope(parsed)) {
          envelopes.push(parsed);
        }
      }
    } catch {}
  }

  envelopes.sort((a, b) => a.seq - b.seq);
  return envelopes;
}

function findLastThreadMessage(item: BaseWorkItem, envelopes: readonly Envelope[]): string | null {
  for (let i = envelopes.length - 1; i >= 0; i--) {
    const env = envelopes[i];
    if (env === undefined) {
      continue;
    }
    const data =
      typeof env.body?.data === "object" && env.body.data !== null
        ? (env.body.data as Record<string, unknown>)
        : undefined;
    const taskMatch =
      data?.["task_id"] === item.id ||
      data?.["id"] === item.id ||
      env.thread === item.id ||
      env.reply_to === item.id ||
      item.topic_seqs.includes(env.seq);

    if (taskMatch) {
      if (typeof env.text === "string" && env.text.trim().length > 0) {
        return env.text.trim();
      }
      if (typeof data?.["text"] === "string" && data["text"].trim().length > 0) {
        return data["text"].trim();
      }
      if (typeof data?.["note"] === "string" && data["note"].trim().length > 0) {
        return data["note"].trim();
      }
    }
  }

  if (item.notes.length > 0) {
    const lastNote = item.notes[item.notes.length - 1];
    if (lastNote !== undefined && lastNote.text.trim().length > 0) {
      return lastNote.text.trim();
    }
  }

  return item.title.trim().length > 0 ? item.title.trim() : null;
}

function resolveAcceptedAt(item: BaseWorkItem, room: string, ports?: HealthPorts): string | null {
  if (item.accepted_at !== null) {
    return item.accepted_at;
  }
  if (item.assignee === null) {
    return null;
  }
  const healthPath = daemonHealthPath(room, item.assignee);
  const health = readHealthRecord(healthPath, ports);
  if (
    health !== null &&
    health.consumer_last_delivered_seq !== null &&
    health.consumer_last_delivered_seq !== undefined &&
    health.consumer_last_delivered_seq >= item.initial_seq
  ) {
    return health.consumer_last_ack_at ?? health.updated_at ?? item.created_at;
  }
  return null;
}

export function scanMineRecovery(identityId: string, ports?: HealthPorts): MineRecoveryReport {
  const root = roomsDir();
  const roomIds = listRoomIds(root, ports);

  const itemsByStatus: Record<string, WorkItem[]> = {
    in_progress: [],
    review: [],
    blocked: [],
    open: [],
  };

  const activeItems: WorkItem[] = [];

  for (const roomId of roomIds) {
    const baseItemsMap = replayWorkItems(roomId, ports);
    const envelopes = readAllEnvelopesForRoom(roomId, ports);

    for (const baseItem of baseItemsMap.values()) {
      if (baseItem.assignee !== identityId) {
        continue;
      }
      if (baseItem.status === "done" || baseItem.status === "dropped") {
        continue;
      }

      const acceptedAt = resolveAcceptedAt(baseItem, roomId, ports);
      const lastMessage = findLastThreadMessage(baseItem, envelopes);

      const enrichedItem: WorkItem = {
        ...baseItem,
        accepted_at: acceptedAt,
        last_thread_message: lastMessage,
      };

      activeItems.push(enrichedItem);

      if (Object.hasOwn(itemsByStatus, enrichedItem.status)) {
        const bucket = itemsByStatus[enrichedItem.status];
        if (bucket !== undefined) {
          bucket.push(enrichedItem);
        }
      } else {
        itemsByStatus[enrichedItem.status] = [enrichedItem];
      }
    }
  }

  for (const statusKey of Object.keys(itemsByStatus)) {
    const bucket = itemsByStatus[statusKey];
    if (bucket !== undefined) {
      bucket.sort((left, right) => {
        const roomCmp = left.room.localeCompare(right.room);
        if (roomCmp !== 0) return roomCmp;
        return left.id.localeCompare(right.id);
      });
    }
  }

  const unseen = activeItems.filter((item) => item.accepted_at === null);
  unseen.sort((left, right) => {
    const roomCmp = left.room.localeCompare(right.room);
    if (roomCmp !== 0) return roomCmp;
    return left.id.localeCompare(right.id);
  });

  return {
    identity: identityId,
    items_by_status: itemsByStatus,
    unseen,
    total_open: activeItems.length,
  };
}
