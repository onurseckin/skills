import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  canonicalJson,
  ChatError,
  isEnvelope,
  roomLogSegmentPath,
  roomQuarantineDir,
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
  const qDir = roomQuarantineDir(roomId);
  if (existsSync(qDir)) {
    const entries = readdirSync(qDir);
    for (const entry of entries) {
      if (entry.endsWith(".json") && !entry.startsWith(".")) {
        const filePath = join(qDir, entry);
        try {
          const content = safeJsonParse(readFileSync(filePath, "utf8"));
          if (
            typeof content === "object" &&
            content !== null &&
            "raw" in content &&
            (content as { readonly raw: unknown }).raw === line
          ) {
            return filePath;
          }
        } catch {}
      }
    }
  }

  const now = new Date().toISOString();
  const sequenceNumber = seq ?? 0;
  let targetPath = roomQuarantinePath(roomId, now, sequenceNumber);
  if (existsSync(targetPath)) {
    let suffix = 1;
    while (existsSync(targetPath)) {
      const sanitizedTs = now.replace(/[:.]/g, "-");
      targetPath = join(qDir, `${sanitizedTs}-${sequenceNumber}-${suffix}.json`);
      suffix++;
    }
  }

  const record = {
    ts: now,
    seq: sequenceNumber,
    reason: reason ?? "Parse failure",
    raw: line,
  };

  writeAtomic(targetPath, canonicalJson(record));
  return targetPath;
}

export function readSegmentEnvelopes(
  segmentPath: string,
  options?: { readonly roomId?: string },
): {
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

  const roomMatch = segmentPath.match(/(?:^|[\\/])rooms[\\/]([^\\/]+)[\\/]log[\\/]/);
  const roomId = options?.roomId ?? roomMatch?.[1];

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
      if (roomId !== undefined && roomId.length > 0) {
        quarantineCorruptLine(roomId, trimmed, undefined, result.error);
      }
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
    const { envelopes } = readSegmentEnvelopes(segmentPath, { roomId });

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
    const { envelopes } = readSegmentEnvelopes(segmentPath, { roomId });

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
