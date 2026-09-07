import { existsSync, readFileSync, statSync } from "node:fs";
import {
  canonicalJson,
  ChatError,
  isLogIndex,
  roomDir,
  roomLogIndexPath,
  roomLogSegmentPath,
  safeJsonParse,
  writeAtomic,
  type LogIndex,
  type RoomSettings,
} from "../core/index.ts";

export function formatSegmentName(segmentNumber: number): string {
  return `${String(segmentNumber).padStart(6, "0")}.jsonl`;
}

export function parseSegmentNumber(segmentName: string): number {
  const numericPart = segmentName.replace(/\.jsonl$/, "");
  const parsed = parseInt(numericPart, 10);
  return Number.isNaN(parsed) ? 1 : parsed;
}

export function getHeadSegment(index: LogIndex): string {
  if (index.segments.length === 0) {
    return "000001.jsonl";
  }
  const last = index.segments[index.segments.length - 1];
  return last ?? "000001.jsonl";
}

export function countSegmentLines(segmentPath: string): number {
  if (!existsSync(segmentPath)) {
    return 0;
  }
  const content = readFileSync(segmentPath, "utf8");
  if (content.length === 0) {
    return 0;
  }
  let count = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") {
      count++;
    }
  }
  if (!content.endsWith("\n")) {
    count++;
  }
  return count;
}

export function shouldRollSegment(segmentPath: string, settings: RoomSettings): boolean {
  if (!existsSync(segmentPath)) {
    return false;
  }

  try {
    const stats = statSync(segmentPath);
    if (stats.size >= settings.segment_max_bytes) {
      return true;
    }
    const lines = countSegmentLines(segmentPath);
    if (lines >= settings.segment_max_lines) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function readLogIndex(roomId: string): LogIndex {
  const indexPath = roomLogIndexPath(roomId);
  if (!existsSync(indexPath)) {
    if (!existsSync(roomDir(roomId))) {
      throw new ChatError("UNKNOWN_ROOM", `Room '${roomId}' not found`);
    }
    return {
      next_seq: 1,
      segments: ["000001.jsonl"],
      head_seq: 0,
      updated_at: new Date().toISOString(),
    };
  }

  try {
    const raw = readFileSync(indexPath, "utf8");
    const parsed = safeJsonParse(raw);
    if (!isLogIndex(parsed)) {
      throw new ChatError("SEGMENT_CORRUPT", `Corrupt log index at '${indexPath}'`);
    }
    return parsed;
  } catch (error: unknown) {
    if (error instanceof ChatError) {
      throw error;
    }
    throw new ChatError(
      "SEGMENT_CORRUPT",
      `Failed to parse log index at '${indexPath}': ${String(error)}`,
    );
  }
}

export function writeLogIndex(roomId: string, index: LogIndex): void {
  if (!isLogIndex(index)) {
    throw new ChatError("INVALID_ARGUMENT", "Invalid log index object");
  }
  const indexPath = roomLogIndexPath(roomId);
  writeAtomic(indexPath, canonicalJson(index));
}

export function rollSegment(
  roomId: string,
  currentIndex: LogIndex,
): { readonly nextIndex: LogIndex; readonly newSegment: string } {
  let highest = 0;
  for (const seg of currentIndex.segments) {
    const parsed = parseSegmentNumber(seg);
    if (parsed > highest) {
      highest = parsed;
    }
  }

  const nextNum = highest + 1;
  const newSegment = formatSegmentName(nextNum);
  const newPath = roomLogSegmentPath(roomId, newSegment);

  if (!existsSync(newPath)) {
    writeAtomic(newPath, "");
  }

  const nextIndex: LogIndex = {
    next_seq: currentIndex.next_seq,
    segments: [...currentIndex.segments, newSegment],
    head_seq: currentIndex.head_seq,
    updated_at: new Date().toISOString(),
  };

  writeLogIndex(roomId, nextIndex);

  return {
    nextIndex,
    newSegment,
  };
}
