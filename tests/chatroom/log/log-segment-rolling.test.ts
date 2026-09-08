import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  countSegmentLines,
  formatSegmentName,
  getHeadSegment,
  parseSegmentNumber,
  readLogIndex,
  rollSegment,
  shouldRollSegment,
  writeLogIndex,
} from "../../../chatroom/scripts/src/log/segments.ts";
import { appendMessage } from "../../../chatroom/scripts/src/log/append.ts";
import { scanContiguousRange, scanRange } from "../../../chatroom/scripts/src/log/scan.ts";
import {
  ackLease,
  createInitialCursor,
  leaseNext,
} from "../../../chatroom/scripts/src/cursor/index.ts";
import {
  ChatError,
  canonicalJson,
  roomLogDir,
  roomLogIndexPath,
  roomLogSegmentPath,
  type Envelope,
  type LogIndex,
  type RoomSettings,
} from "../../../chatroom/scripts/src/core/index.ts";
import { readRoomManifest } from "../../../chatroom/scripts/src/room/index.ts";
import {
  cleanupVirtualChatroomFS,
  createTestRoom,
  setupVirtualChatroomFS,
  type VirtualChatroomContext,
} from "../helpers.ts";

let context: VirtualChatroomContext;

beforeEach(() => {
  context = setupVirtualChatroomFS();
});

afterEach(() => {
  cleanupVirtualChatroomFS();
});

describe("chatroom log segments unit tests", () => {
  it("formatSegmentName pads numbers to six digits with jsonl extension", () => {
    expect(formatSegmentName(1)).toBe("000001.jsonl");
    expect(formatSegmentName(12)).toBe("000012.jsonl");
    expect(formatSegmentName(123456)).toBe("123456.jsonl");
  });

  it("parseSegmentNumber extracts numeric component and falls back to 1", () => {
    expect(parseSegmentNumber("000005.jsonl")).toBe(5);
    expect(parseSegmentNumber("000123.jsonl")).toBe(123);
    expect(parseSegmentNumber("malformed.jsonl")).toBe(1);
    expect(parseSegmentNumber("non-numeric")).toBe(1);
    expect(parseSegmentNumber("")).toBe(1);
  });

  it("getHeadSegment returns default for empty index and last segment when populated", () => {
    const emptyIndex: LogIndex = {
      next_seq: 1,
      segments: [],
      head_seq: 0,
      updated_at: "2026-09-07T00:00:00.000Z",
    };
    expect(getHeadSegment(emptyIndex)).toBe("000001.jsonl");

    const populatedIndex: LogIndex = {
      next_seq: 5,
      segments: ["000001.jsonl", "000002.jsonl", "000005.jsonl"],
      head_seq: 4,
      updated_at: "2026-09-07T00:00:00.000Z",
    };
    expect(getHeadSegment(populatedIndex)).toBe("000005.jsonl");
  });

  it("countSegmentLines correctly counts empty files and newline variations", () => {
    const testDir = `${context.homeDir}/test-lines`;
    context.vfs.mkdirSync(testDir, { recursive: true });

    expect(countSegmentLines(`${testDir}/nonexistent.jsonl`)).toBe(0);

    context.vfs.writeFileSync(`${testDir}/empty.jsonl`, "");
    expect(countSegmentLines(`${testDir}/empty.jsonl`)).toBe(0);

    context.vfs.writeFileSync(`${testDir}/trailing.jsonl`, "line1\nline2\nline3\n");
    expect(countSegmentLines(`${testDir}/trailing.jsonl`)).toBe(3);

    context.vfs.writeFileSync(`${testDir}/no-trailing.jsonl`, "line1\nline2");
    expect(countSegmentLines(`${testDir}/no-trailing.jsonl`)).toBe(2);
  });

  it("shouldRollSegment checks existence, byte size thresholds, and line thresholds", () => {
    const testDir = `${context.homeDir}/test-should-roll`;
    context.vfs.mkdirSync(testDir, { recursive: true });

    const settings: RoomSettings = {
      lease_ttl_ms: 60000,
      max_payload_bytes: 1000,
      segment_max_bytes: 200,
      segment_max_lines: 4,
    };

    expect(shouldRollSegment(`${testDir}/nonexistent.jsonl`, settings)).toBe(false);

    context.vfs.writeFileSync(`${testDir}/under.jsonl`, "line1\nline2\n");
    expect(shouldRollSegment(`${testDir}/under.jsonl`, settings)).toBe(false);

    context.vfs.writeFileSync(`${testDir}/lines.jsonl`, "1\n2\n3\n4\n");
    expect(shouldRollSegment(`${testDir}/lines.jsonl`, settings)).toBe(true);

    context.vfs.writeFileSync(`${testDir}/bytes.jsonl`, "x".repeat(250));
    expect(shouldRollSegment(`${testDir}/bytes.jsonl`, settings)).toBe(true);
  });

  it("readLogIndex validates existence, handles defaults, and detects corruption", () => {
    let unknownRoomError: ChatError | null = null;
    try {
      readLogIndex("unknown-room-xyz");
    } catch (error: unknown) {
      if (error instanceof ChatError) {
        unknownRoomError = error;
      }
    }
    expect(unknownRoomError).not.toBeNull();
    expect(unknownRoomError?.code).toBe("UNKNOWN_ROOM");

    context.vfs.mkdirSync(`${context.homeDir}/rooms/no-index-room`, { recursive: true });
    const defaultIndex = readLogIndex("no-index-room");
    expect(defaultIndex.next_seq).toBe(1);
    expect(defaultIndex.head_seq).toBe(0);
    expect(defaultIndex.segments).toEqual(["000001.jsonl"]);
    expect(typeof defaultIndex.updated_at).toBe("string");

    createTestRoom({ id: "corrupt-probe-room", createdBy: "tester" });
    const indexPath = roomLogIndexPath("corrupt-probe-room");

    context.vfs.writeFileSync(indexPath, "not valid json {{{");
    let corruptParseError: ChatError | null = null;
    try {
      readLogIndex("corrupt-probe-room");
    } catch (error: unknown) {
      if (error instanceof ChatError) {
        corruptParseError = error;
      }
    }
    expect(corruptParseError).not.toBeNull();
    expect(corruptParseError?.code).toBe("SEGMENT_CORRUPT");

    context.vfs.writeFileSync(indexPath, JSON.stringify({ invalid_schema: true }));
    let corruptSchemaError: ChatError | null = null;
    try {
      readLogIndex("corrupt-probe-room");
    } catch (error: unknown) {
      if (error instanceof ChatError) {
        corruptSchemaError = error;
      }
    }
    expect(corruptSchemaError).not.toBeNull();
    expect(corruptSchemaError?.code).toBe("SEGMENT_CORRUPT");
  });

  it("writeLogIndex writes canonical JSON atomically and validates schema", () => {
    createTestRoom({ id: "write-index-room", createdBy: "tester" });
    const testIndex: LogIndex = {
      next_seq: 10,
      segments: ["000001.jsonl", "000002.jsonl"],
      head_seq: 9,
      updated_at: "2026-09-07T12:00:00.000Z",
    };

    writeLogIndex("write-index-room", testIndex);
    const written = context.vfs.readFileSync(roomLogIndexPath("write-index-room"), "utf8");
    expect(written).toBe(canonicalJson(testIndex));
    expect(readLogIndex("write-index-room")).toEqual(testIndex);

    const invalidIndex = {
      next_seq: "not-a-number",
      segments: [123],
    } as unknown as LogIndex;
    let writeError: ChatError | null = null;
    try {
      writeLogIndex("write-index-room", invalidIndex);
    } catch (error: unknown) {
      if (error instanceof ChatError) {
        writeError = error;
      }
    }
    expect(writeError).not.toBeNull();
    expect(writeError?.code).toBe("INVALID_ARGUMENT");
  });

  it("rollSegment increments segment, creates file, and updates index atomically", () => {
    createTestRoom({ id: "roll-op-room", createdBy: "tester" });
    const initialIndex = readLogIndex("roll-op-room");
    expect(initialIndex.segments).toEqual(["000001.jsonl"]);

    const rolled = rollSegment("roll-op-room", initialIndex);
    expect(rolled.newSegment).toBe("000002.jsonl");
    expect(rolled.nextIndex.segments).toEqual(["000001.jsonl", "000002.jsonl"]);
    expect(rolled.nextIndex.next_seq).toBe(initialIndex.next_seq);
    expect(rolled.nextIndex.head_seq).toBe(initialIndex.head_seq);

    const newSegmentPath = roomLogSegmentPath("roll-op-room", "000002.jsonl");
    expect(context.vfs.existsSync(newSegmentPath)).toBe(true);

    const updatedOnDisk = readLogIndex("roll-op-room");
    expect(updatedOnDisk).toEqual(rolled.nextIndex);
  });
});

describe("chatroom multi-segment rolling and reader boundary traversal", () => {
  it("rolls across 10 messages creating 4 segments and guarantees monotonic delivery", () => {
    const tempHome = "/virtual/chat-rolling-suite";
    const isolatedContext = setupVirtualChatroomFS(tempHome);
    try {
      const room = "rolling-stream-room";
      const author = "agent-author";

      createTestRoom({
        id: room,
        title: "Rolling Stream Room",
        createdBy: author,
      });

      const manifest = readRoomManifest(room);
      const settingsOverride: RoomSettings = {
        ...manifest.settings,
        segment_max_lines: 3,
        segment_max_bytes: 5000,
      };

      const appendedEnvelopes: Envelope[] = [];
      const sender = { id: author, role: "agent", host: "virtual" };

      for (let i = 1; i <= 10; i++) {
        const env = appendMessage(
          room,
          {
            sender,
            kind: "message",
            text: `payload-${i}`,
            body: { schema: "text", data: { text: `payload-${i}` } },
          },
          undefined,
          settingsOverride,
        );
        appendedEnvelopes.push(env);
      }

      const assignedSeqs = appendedEnvelopes.map((env) => env.seq);
      expect(assignedSeqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      const logIndex = readLogIndex(room);
      expect(logIndex.segments).toEqual([
        "000001.jsonl",
        "000002.jsonl",
        "000003.jsonl",
        "000004.jsonl",
      ]);
      expect(logIndex.head_seq).toBe(10);
      expect(logIndex.next_seq).toBe(11);

      const segmentFiles = ["000001.jsonl", "000002.jsonl", "000003.jsonl", "000004.jsonl"];
      for (const seg of segmentFiles) {
        const segPath = roomLogSegmentPath(room, seg);
        expect(isolatedContext.vfs.existsSync(segPath)).toBe(true);
      }

      const parseSegmentLines = (seg: string): number[] => {
        const raw = isolatedContext.vfs.readFileSync(roomLogSegmentPath(room, seg), "utf8");
        const lines = raw
          .trim()
          .split("\n")
          .filter((line) => line.length > 0);
        return lines.map((line) => {
          const parsed = JSON.parse(line) as { seq: number };
          return parsed.seq;
        });
      };

      const seg1Seqs = parseSegmentLines("000001.jsonl");
      const seg2Seqs = parseSegmentLines("000002.jsonl");
      const seg3Seqs = parseSegmentLines("000003.jsonl");
      const seg4Seqs = parseSegmentLines("000004.jsonl");

      expect(seg1Seqs).toEqual([1, 2, 3]);
      expect(seg2Seqs).toEqual([4, 5, 6]);
      expect(seg3Seqs).toEqual([7, 8, 9]);
      expect(seg4Seqs).toEqual([10]);

      const allDiskSeqs = [...seg1Seqs, ...seg2Seqs, ...seg3Seqs, ...seg4Seqs];
      expect(allDiskSeqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(new Set(allDiskSeqs).size).toBe(10);

      const replayedScan = scanRange(room, 1, 50);
      expect(replayedScan.map((env) => env.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      const replayedContiguous = scanContiguousRange(room, 1, 10);
      expect(replayedContiguous.map((env) => env.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      let readerCursor = createInitialCursor(room, "boundary-reader");
      const logDir = roomLogDir(room);

      const batch1 = leaseNext(readerCursor, logDir, 4);
      expect(batch1.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
      expect(typeof batch1.leaseId).toBe("string");
      readerCursor = ackLease(batch1.cursor, batch1.leaseId as string, null, {
        kind: "explicit",
        at: new Date().toISOString(),
      });
      expect(readerCursor.contiguous_seq).toBe(4);

      const batch2 = leaseNext(readerCursor, logDir, 4);
      expect(batch2.messages.map((m) => m.seq)).toEqual([5, 6, 7, 8]);
      expect(typeof batch2.leaseId).toBe("string");
      readerCursor = ackLease(batch2.cursor, batch2.leaseId as string, null, {
        kind: "explicit",
        at: new Date().toISOString(),
      });
      expect(readerCursor.contiguous_seq).toBe(8);

      const batch3 = leaseNext(readerCursor, logDir, 4);
      expect(batch3.messages.map((m) => m.seq)).toEqual([9, 10]);
      expect(typeof batch3.leaseId).toBe("string");
      readerCursor = ackLease(batch3.cursor, batch3.leaseId as string, null, {
        kind: "explicit",
        at: new Date().toISOString(),
      });
      expect(readerCursor.contiguous_seq).toBe(10);

      const batch4 = leaseNext(readerCursor, logDir, 4);
      expect(batch4.messages).toEqual([]);
      expect(batch4.leaseId).toBeNull();
      expect(readerCursor.contiguous_seq).toBe(10);
    } finally {
      cleanupVirtualChatroomFS();
    }
  });
});
