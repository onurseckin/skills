import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isEnvelope,
  roomDir,
  roomLogIndexPath,
  roomLogSegmentPath,
  type Envelope,
  writeAtomic,
} from "../core/index.ts";
import { type HealthPorts } from "../daemon/index.ts";
import { foldWorkItems } from "./projection.ts";
import { type WorkItem } from "./types.ts";

const memoryCache = new Map<string, Map<string, WorkItem>>();

export function getWorkCachePath(room: string): string {
  return join(roomDir(room), "work.cache.json");
}

export function clearWorkItemsCache(room?: string, ports?: HealthPorts): void {
  if (room !== undefined) {
    memoryCache.delete(room);
    const cachePath = getWorkCachePath(room);
    const existsFn = ports?.existsSync ?? existsSync;
    if (existsFn(cachePath)) {
      const writeFn =
        ports?.writeAtomic ??
        ports?.writeFileSync ??
        ((target: string, content: string) => writeAtomic(target, content));
      try {
        writeFn(cachePath, "");
      } catch {
        return;
      }
    }
  } else {
    memoryCache.clear();
  }
}

export function readRoomLogEnvelopes(room: string, ports?: HealthPorts): readonly Envelope[] {
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
    } catch {
      void 0;
    }
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
    const content = readFn(segPath, "utf8");
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (isEnvelope(parsed)) {
          envelopes.push(parsed);
        }
      } catch {
        continue;
      }
    }
  }

  envelopes.sort((a, b) => a.seq - b.seq);
  return envelopes;
}

export function loadWorkItems(room: string, ports?: HealthPorts): Map<string, WorkItem> {
  const cached = memoryCache.get(room);
  if (cached) {
    return new Map(cached);
  }

  const cachePath = getWorkCachePath(room);
  const existsFn = ports?.existsSync ?? existsSync;
  const readFn = ports?.readFileSync ?? readFileSync;

  if (existsFn(cachePath)) {
    try {
      const content = readFn(cachePath, "utf8");
      if (content.trim().length > 0) {
        const parsed: unknown = JSON.parse(content);
        if (Array.isArray(parsed)) {
          const map = new Map<string, WorkItem>();
          for (const item of parsed) {
            if (
              typeof item === "object" &&
              item !== null &&
              "id" in item &&
              typeof (item as { id: unknown }).id === "string"
            ) {
              map.set((item as WorkItem).id, item as WorkItem);
            }
          }
          memoryCache.set(room, map);
          return new Map(map);
        }
      }
    } catch {
      void 0;
    }
  }

  return replayWorkItems(room, ports);
}

export function replayWorkItems(room: string, ports?: HealthPorts): Map<string, WorkItem> {
  const envelopes = readRoomLogEnvelopes(room, ports);
  const folded = foldWorkItems(envelopes, room);

  memoryCache.set(room, folded);

  const cachePath = getWorkCachePath(room);
  const writeFn =
    ports?.writeAtomic ??
    ports?.writeFileSync ??
    ((target: string, content: string) => writeAtomic(target, content));

  try {
    writeFn(cachePath, JSON.stringify(Array.from(folded.values()), null, 2));
  } catch {
    return new Map(folded);
  }

  return new Map(folded);
}
