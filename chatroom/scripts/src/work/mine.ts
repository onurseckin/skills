import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  daemonHealthPath,
  isEnvelope,
  roomLogIndexPath,
  roomLogSegmentPath,
  roomMemberPath,
  roomsDir,
  type Envelope,
} from "../core/index.ts";
import { readHealthRecord, type HealthPorts } from "../daemon/index.ts";
import { extractMemberBrief, foldMemberBriefs, type MemberBriefRecord } from "./brief.ts";
import { replayWorkItems } from "./store.ts";
import type { WorkItem as BaseWorkItem, WorkItemStatus } from "./types.ts";

export type { WorkItemStatus } from "./types.ts";
export { foldMemberBriefs } from "./brief.ts";

export interface WorkItem extends BaseWorkItem {
  readonly last_thread_message: string | null;
}

export interface MineRecoveryRoom {
  readonly room: string;
  readonly member: string;
  readonly brief: MemberBriefRecord | null;
  readonly items: WorkItem[];
  readonly items_by_status: Record<string, WorkItem[]>;
  readonly unseen: WorkItem[];
  readonly total_open: number;
}

export interface MineRecoveryReport {
  readonly identity: string;
  readonly items_by_status: Record<string, WorkItem[]>;
  readonly unseen: WorkItem[];
  readonly total_open: number;
  readonly rooms: readonly MineRecoveryRoom[];
  readonly brief: MemberBriefRecord | null;
}

export interface ExtendedHealthPorts extends HealthPorts {
  readonly readdirSync?: (path: string) => string[] | { name: string; isDirectory(): boolean }[];
  readonly statSync?: (path: string) => { isDirectory(): boolean };
  readonly fs?: { readonly existsSync?: (path: string) => boolean };
}

function listRoomIds(root: string, ports?: HealthPorts): readonly string[] {
  const existsFn = ports?.existsSync ?? existsSync;
  if (!existsFn(root)) return [];
  const ext = ports as ExtendedHealthPorts | undefined;
  const readDirFn = ext?.readdirSync ?? readdirSync;
  try {
    const rawEntries = readDirFn(root);
    const names: string[] = [];
    for (const entry of rawEntries) {
      const name = typeof entry === "string" ? entry : entry.name;
      if (!name || name.startsWith(".")) continue;
      const roomPath = join(root, name);
      const isDir =
        existsFn(join(roomPath, "room.json")) ||
        existsFn(join(roomPath, "log")) ||
        existsFn(join(roomPath, "log.index.json")) ||
        ext?.statSync?.(roomPath)?.isDirectory() ||
        (() => {
          try {
            return statSync(roomPath).isDirectory();
          } catch {
            return false;
          }
        })();
      if (isDir) names.push(name);
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
      const parsed: unknown = JSON.parse(readFn(indexPath, "utf8"));
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "segments" in parsed &&
        Array.isArray((parsed as { segments: unknown }).segments)
      ) {
        for (const seg of (parsed as { segments: readonly unknown[] }).segments) {
          if (typeof seg === "string") segments.push(seg);
        }
      }
    } catch {}
  }

  if (segments.length === 0) {
    let segNum = 1;
    while (true) {
      const segName = `${String(segNum).padStart(6, "0")}.jsonl`;
      if (!existsFn(roomLogSegmentPath(room, segName))) break;
      segments.push(segName);
      segNum++;
    }
  }

  const envelopes: Envelope[] = [];
  for (const segName of segments) {
    const segPath = roomLogSegmentPath(room, segName);
    if (!existsFn(segPath)) continue;
    try {
      for (const line of readFn(segPath, "utf8").split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        const parsed: unknown = JSON.parse(trimmed);
        if (isEnvelope(parsed)) envelopes.push(parsed);
      }
    } catch {}
  }
  return envelopes.sort((a, b) => a.seq - b.seq);
}

function findLastThreadMessage(item: BaseWorkItem, envelopes: readonly Envelope[]): string | null {
  for (let i = envelopes.length - 1; i >= 0; i--) {
    const env = envelopes[i];
    if (env === undefined) continue;
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
      if (typeof env.text === "string" && env.text.trim().length > 0) return env.text.trim();
      if (typeof data?.["text"] === "string" && data["text"].trim().length > 0)
        return data["text"].trim();
      if (typeof data?.["note"] === "string" && data["note"].trim().length > 0)
        return data["note"].trim();
    }
  }

  if (item.notes.length > 0) {
    const lastNote = item.notes[item.notes.length - 1];
    if (lastNote !== undefined && lastNote.text.trim().length > 0) return lastNote.text.trim();
  }
  return item.title.trim().length > 0 ? item.title.trim() : null;
}

function resolveAcceptedAt(item: BaseWorkItem, room: string, ports?: HealthPorts): string | null {
  if (item.accepted_at !== null) return item.accepted_at;
  if (item.assignee === null) return null;
  const health = readHealthRecord(daemonHealthPath(room, item.assignee), ports);
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
  const asMember = identityId;
  const itemsByStatus: Record<string, WorkItem[]> = {
    in_progress: [],
    review: [],
    blocked: [],
    open: [],
  };
  const activeItems: WorkItem[] = [];
  const rooms: MineRecoveryRoom[] = [];
  let latestBrief: MemberBriefRecord | null = null;

  for (const roomId of roomIds) {
    const memberFile = roomMemberPath(roomId, identityId);
    const isMember = ports?.fs?.existsSync
      ? ports.fs.existsSync(memberFile)
      : ports?.existsSync
        ? ports.existsSync(memberFile)
        : existsSync(memberFile);
    if (!isMember) continue;

    const baseItemsMap = replayWorkItems(roomId, ports);
    const envelopes = readAllEnvelopesForRoom(roomId, ports);
    const brief = extractMemberBrief(envelopes, asMember);

    if (brief !== null && (latestBrief === null || brief.seq >= latestBrief.seq)) {
      latestBrief = brief;
    }

    const roomItems: WorkItem[] = [];
    const roomItemsByStatus: Record<string, WorkItem[]> = {
      in_progress: [],
      review: [],
      blocked: [],
      open: [],
    };

    for (const baseItem of baseItemsMap.values()) {
      if (
        baseItem.assignee !== identityId ||
        baseItem.status === "done" ||
        baseItem.status === "dropped"
      )
        continue;

      const acceptedAt = resolveAcceptedAt(baseItem, roomId, ports);
      const lastMessage = findLastThreadMessage(baseItem, envelopes);
      const enrichedItem: WorkItem = {
        ...baseItem,
        accepted_at: acceptedAt,
        last_thread_message: lastMessage,
      };

      roomItems.push(enrichedItem);
      activeItems.push(enrichedItem);

      if (Object.hasOwn(roomItemsByStatus, enrichedItem.status)) {
        roomItemsByStatus[enrichedItem.status]?.push(enrichedItem);
      } else {
        roomItemsByStatus[enrichedItem.status] = [enrichedItem];
      }

      if (Object.hasOwn(itemsByStatus, enrichedItem.status)) {
        itemsByStatus[enrichedItem.status]?.push(enrichedItem);
      } else {
        itemsByStatus[enrichedItem.status] = [enrichedItem];
      }
    }

    for (const statusKey of Object.keys(roomItemsByStatus)) {
      roomItemsByStatus[statusKey]?.sort((left, right) => left.id.localeCompare(right.id));
    }

    const roomUnseen = roomItems.filter((item) => item.accepted_at === null);
    roomUnseen.sort((left, right) => left.id.localeCompare(right.id));

    rooms.push({
      room: roomId,
      member: identityId,
      brief,
      items: roomItems,
      items_by_status: roomItemsByStatus,
      unseen: roomUnseen,
      total_open: roomItems.length,
    });
  }

  for (const statusKey of Object.keys(itemsByStatus)) {
    itemsByStatus[statusKey]?.sort((left, right) => {
      const roomCmp = left.room.localeCompare(right.room);
      return roomCmp !== 0 ? roomCmp : left.id.localeCompare(right.id);
    });
  }

  const unseen = activeItems.filter((item) => item.accepted_at === null);
  unseen.sort((left, right) => {
    const roomCmp = left.room.localeCompare(right.room);
    return roomCmp !== 0 ? roomCmp : left.id.localeCompare(right.id);
  });

  return {
    identity: identityId,
    items_by_status: itemsByStatus,
    unseen,
    total_open: activeItems.length,
    rooms,
    brief: latestBrief,
  };
}

function formatBriefBlock(
  member: string,
  room: string,
  brief: MemberBriefRecord | null,
): readonly string[] {
  if (brief !== null) {
    return [
      `=== RECOVERY BRIEF (${member}) ===`,
      `Last updated: ${brief.updated_at}`,
      brief.text,
      "=================================",
    ];
  }
  return [
    `[NOTICE] No recovery brief set for ${member} in room ${room}. Run 'chat brief --set <text>' to record context.`,
  ];
}

function formatTaskSections(
  unseen: readonly WorkItem[],
  itemsByStatus: Record<string, readonly WorkItem[]>,
  totalOpen: number,
): readonly string[] {
  const lines: string[] = [];
  if (unseen.length > 0) {
    lines.push("", `*** UNSEEN WORK ITEMS (${unseen.length}) ***`);
    for (const item of unseen) {
      lines.push(
        `  [UNSEEN] ${item.id} - ${item.title}`,
        `    Room: ${item.room} | Status: ${item.status}`,
        `    Last Thread Message: ${item.last_thread_message ?? "(none)"}`,
      );
    }
  }

  const statuses = ["in_progress", "review", "blocked", "open"] as const;
  for (const status of statuses) {
    const items = itemsByStatus[status] ?? [];
    if (items.length > 0) {
      lines.push("", `-- ${status.replace(/_/g, " ").toUpperCase()} (${items.length}) --`);
      for (const item of items) {
        const unseenTag = item.accepted_at === null ? " [UNSEEN]" : "";
        lines.push(
          `  * ${item.id}: ${item.title}${unseenTag}`,
          `    Room: ${item.room} | Status: ${item.status}`,
          `    Last Thread Message: ${item.last_thread_message ?? "(none)"}`,
        );
      }
    }
  }

  if (totalOpen === 0) lines.push("", "No open work items found.");
  return lines;
}

function formatRoomRecovery(room: MineRecoveryRoom, memberOverride?: string): string {
  const member = memberOverride ?? room.member ?? room.brief?.member_id ?? "unknown";
  return [
    ...formatBriefBlock(member, room.room, room.brief),
    ...formatTaskSections(room.unseen, room.items_by_status, room.total_open),
  ].join("\n");
}

function formatReportRecovery(report: MineRecoveryReport): string {
  const lines: string[] = [
    `Recovery View: ${report.identity} (${report.total_open} open items)`,
    "=".repeat(60),
  ];
  for (const room of report.rooms) {
    lines.push("", ...formatBriefBlock(report.identity, room.room, room.brief));
  }
  lines.push(...formatTaskSections(report.unseen, report.items_by_status, report.total_open));
  return lines.join("\n");
}

export function formatMineRecovery(
  target: MineRecoveryReport | MineRecoveryRoom,
  memberOverride?: string,
): string {
  if ("room" in target && typeof target.room === "string") {
    return formatRoomRecovery(target, memberOverride);
  }
  return formatReportRecovery(target as MineRecoveryReport);
}
