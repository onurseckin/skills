import { existsSync, readFileSync } from "node:fs";
import {
  canonicalJson,
  ChatError,
  isEnvelope,
  roomLogSegmentPath,
  roomQuarantinePath,
  safeJsonParse,
  writeAtomic,
  type Envelope,
} from "../core/index.ts";
import { readLogIndex } from "./segments.ts";

export type ParseLineResult =
  | { readonly success: true; readonly envelope: Envelope }
  | { readonly success: false; readonly error: string };

export function parseLogLine(line: string): ParseLineResult {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return {
      success: false,
      error: "Empty line",
    };
  }

  try {
    const parsed = safeJsonParse(trimmed);
    if (!isEnvelope(parsed)) {
      return {
        success: false,
        error: "Line is not a valid envelope structure",
      };
    }
    return {
      success: true,
      envelope: parsed,
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function quarantineCorruptLine(
  roomId: string,
  line: string,
  seq?: number,
  reason?: string,
): string {
  const now = new Date().toISOString();
  const sequenceNumber = seq ?? 0;
  const targetPath = roomQuarantinePath(roomId, now, sequenceNumber);

  const record = {
    ts: now,
    seq: sequenceNumber,
    reason: reason ?? "Parse failure",
    raw: line,
  };

  writeAtomic(targetPath, canonicalJson(record));
  return targetPath;
}

export function readSegmentEnvelopes(segmentPath: string): {
  readonly envelopes: readonly Envelope[];
  readonly tornLines: readonly string[];
} {
  if (!existsSync(segmentPath)) {
    return { envelopes: [], tornLines: [] };
  }

  const content = readFileSync(segmentPath, "utf8");
  if (content.length === 0) {
    return { envelopes: [], tornLines: [] };
  }

  const lines = content.split("\n");
  const envelopes: Envelope[] = [];
  const tornLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) {
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const result = parseLogLine(trimmed);
    if (result.success) {
      envelopes.push(result.envelope);
    } else {
      tornLines.push(trimmed);
    }
  }

  return {
    envelopes,
    tornLines,
  };
}

export function scanRange(roomId: string, fromSeq: number, limit = 50): readonly Envelope[] {
  if (fromSeq < 1) {
    throw new ChatError("INVALID_ARGUMENT", `fromSeq must be at least 1, received ${fromSeq}`);
  }
  if (limit <= 0) {
    return [];
  }

  const index = readLogIndex(roomId);
  const collected: Envelope[] = [];

  for (const segment of index.segments) {
    const segmentPath = roomLogSegmentPath(roomId, segment);
    const { envelopes } = readSegmentEnvelopes(segmentPath);

    for (const envelope of envelopes) {
      if (envelope.seq >= fromSeq) {
        collected.push(envelope);
        if (collected.length >= limit) {
          return collected;
        }
      }
    }
  }

  return collected;
}

export function scanContiguousRange(
  roomId: string,
  fromSeq: number,
  toSeq?: number,
): readonly Envelope[] {
  if (fromSeq < 1) {
    throw new ChatError("INVALID_ARGUMENT", `fromSeq must be at least 1, received ${fromSeq}`);
  }

  const index = readLogIndex(roomId);
  const result: Envelope[] = [];
  let expectedSeq = fromSeq;

  for (const segment of index.segments) {
    const segmentPath = roomLogSegmentPath(roomId, segment);
    const { envelopes } = readSegmentEnvelopes(segmentPath);

    for (const envelope of envelopes) {
      if (envelope.seq < expectedSeq) {
        continue;
      }
      if (envelope.seq === expectedSeq) {
        if (toSeq !== undefined && envelope.seq > toSeq) {
          return result;
        }
        result.push(envelope);
        expectedSeq++;
      } else {
        return result;
      }
    }
  }

  return result;
}
