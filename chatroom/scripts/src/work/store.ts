import { existsSync, readFileSync } from "node:fs";
import { isEnvelope, roomLogIndexPath, roomLogSegmentPath, type Envelope } from "../core/index.ts";
import { type HealthPorts } from "../daemon/index.ts";
import { foldWorkItems } from "./projection.ts";
import { type WorkItem } from "./types.ts";

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

export function replayWorkItems(room: string, ports?: HealthPorts): Map<string, WorkItem> {
  const envelopes = readRoomLogEnvelopes(room, ports);
  return foldWorkItems(envelopes, room);
}
