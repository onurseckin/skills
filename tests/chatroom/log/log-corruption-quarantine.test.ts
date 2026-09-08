import { describe, expect, it } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctorCommand } from "../../../chatroom/scripts/src/cli/commands/doctor.ts";
import {
  roomLogDir,
  roomLogSegmentPath,
  roomQuarantineDir,
} from "../../../chatroom/scripts/src/core/paths.ts";
import { createInitialCursor, leaseNext } from "../../../chatroom/scripts/src/cursor/index.ts";
import { appendMessage } from "../../../chatroom/scripts/src/log/append.ts";
import {
  quarantineCorruptLine,
  readSegmentEnvelopes,
  scanRange,
} from "../../../chatroom/scripts/src/log/scan.ts";
import { readLogIndex, writeLogIndex } from "../../../chatroom/scripts/src/log/segments.ts";
import { addMember, createRoom } from "../../../chatroom/scripts/src/room/index.ts";

describe("log corruption quarantine and doctor integration", () => {
  it("quarantines torn log line, readers skip it gracefully, deduplicates repeated reads, and doctor reports degraded health", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "chat-quarantine-test-"));
    const prevHome = process.env["CHATROOM_HOME"];
    process.env["CHATROOM_HOME"] = tempDir;

    try {
      const room = "quarantine-room-1";
      const reader = "reader-agent-1";

      createRoom({
        id: room,
        title: "Quarantine Test Room",
        visibility: "public",
        createdBy: reader,
      });

      addMember(room, {
        id: reader,
        role: "agent",
        host: "antigravity",
      });

      const sender = { id: reader, role: "agent" as const, host: "antigravity" };

      const env1 = appendMessage(room, {
        sender,
        kind: "message",
        body: { schema: "text", data: { text: "msg-1-valid" } },
      });
      expect(env1.seq).toBe(1);

      const segmentPath = roomLogSegmentPath(room, 1);
      const tornLine = '{"seq":2,"broken\n';
      appendFileSync(segmentPath, tornLine, "utf8");

      const env3 = appendMessage(room, {
        sender,
        kind: "message",
        body: { schema: "text", data: { text: "msg-3-valid" } },
      });
      expect(env3.seq === 2 || env3.seq === 3).toBe(true);

      const segmentResult = readSegmentEnvelopes(segmentPath);
      expect(segmentResult.envelopes).toHaveLength(2);
      expect(segmentResult.envelopes[0].seq).toBe(1);
      expect(segmentResult.envelopes[0].body.data).toEqual({ text: "msg-1-valid" });
      expect([2, 3]).toContain(segmentResult.envelopes[1].seq);
      expect(segmentResult.envelopes[1].body.data).toEqual({ text: "msg-3-valid" });
      expect(segmentResult.tornLines).toHaveLength(1);
      expect(segmentResult.tornLines[0]).toBe('{"seq":2,"broken');

      const scanned = scanRange(room, 1);
      expect(scanned).toHaveLength(2);
      expect(scanned[0].seq).toBe(1);
      expect([2, 3]).toContain(scanned[1].seq);

      const qDir = roomQuarantineDir(room);
      const qFiles = readdirSync(qDir).filter((file) => !file.startsWith("."));
      expect(qFiles).toHaveLength(1);

      const quarantineRecordPath = join(qDir, qFiles[0]);
      const quarantineRecord = JSON.parse(readFileSync(quarantineRecordPath, "utf8")) as {
        readonly ts: string;
        readonly seq: number;
        readonly reason: string;
        readonly raw: string;
      };
      expect(quarantineRecord.seq).toBe(0);
      expect(quarantineRecord.raw).toBe('{"seq":2,"broken');
      expect(typeof quarantineRecord.reason).toBe("string");
      expect(quarantineRecord.reason.length).toBeGreaterThan(0);

      const repeatSegmentResult = readSegmentEnvelopes(segmentPath);
      expect(repeatSegmentResult.envelopes).toHaveLength(2);
      const repeatScanned = scanRange(room, 1);
      expect(repeatScanned).toHaveLength(2);

      const qFilesAfterRepeat = readdirSync(qDir).filter((file) => !file.startsWith("."));
      expect(qFilesAfterRepeat).toHaveLength(1);
      expect(qFilesAfterRepeat[0]).toBe(qFiles[0]);

      const doctorResult = await doctorCommand({ room });
      expect(doctorResult.is_healthy).toBe(false);
      expect(doctorResult.rooms).toHaveLength(1);

      const roomReport = doctorResult.rooms[0];
      expect(roomReport).toBeDefined();
      if (roomReport) {
        expect(roomReport.quarantined).toBe(1);
        expect(roomReport.quarantined_count).toBe(1);
        expect(roomReport.quarantined_lines).toHaveLength(1);
      }

      expect(doctorResult.markdown).toContain("Quarantined");
      expect(doctorResult.markdown).toContain("WARNING: quarantined envelopes detected");
    } finally {
      if (prevHome !== undefined) {
        process.env["CHATROOM_HOME"] = prevHome;
      } else {
        delete process.env["CHATROOM_HOME"];
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("deduplicates identical corrupt lines in quarantineCorruptLine", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "chat-quarantine-dedup-"));
    const prevHome = process.env["CHATROOM_HOME"];
    process.env["CHATROOM_HOME"] = tempDir;

    try {
      const room = "dedup-room";
      createRoom({
        id: room,
        title: "Dedup Room",
        visibility: "public",
        createdBy: "tester",
      });

      const badLine = '{"bad":1,"incomplete';
      const path1 = quarantineCorruptLine(room, badLine, 0, "SyntaxError: Unexpected end of JSON");
      const path2 = quarantineCorruptLine(room, badLine, 0, "SyntaxError: Unexpected end of JSON");

      expect(path1).toBe(path2);

      const qDir = roomQuarantineDir(room);
      const qFiles = readdirSync(qDir).filter((file) => !file.startsWith("."));
      expect(qFiles).toHaveLength(1);

      const differentBadLine = '{"bad":2,"truncated';
      const path3 = quarantineCorruptLine(
        room,
        differentBadLine,
        0,
        "SyntaxError: Unexpected token",
      );
      expect(path3).not.toBe(path1);

      const qFilesAfter = readdirSync(qDir).filter((file) => !file.startsWith("."));
      expect(qFilesAfter).toHaveLength(2);
    } finally {
      if (prevHome !== undefined) {
        process.env["CHATROOM_HOME"] = prevHome;
      } else {
        delete process.env["CHATROOM_HOME"];
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("quarantines corrupt line during lease reading and delivers contiguous valid messages", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "chat-lease-quarantine-"));
    const prevHome = process.env["CHATROOM_HOME"];
    process.env["CHATROOM_HOME"] = tempDir;

    try {
      const room = "lease-quarantine-room";
      const reader = "reader-agent-1";

      createRoom({
        id: room,
        title: "Lease Quarantine Room",
        visibility: "public",
        createdBy: reader,
      });

      addMember(room, {
        id: reader,
        role: "agent",
        host: "antigravity",
      });

      const sender = { id: reader, role: "agent" as const, host: "antigravity" };

      const env1 = appendMessage(room, {
        sender,
        kind: "message",
        body: { schema: "text", data: { text: "msg-1-valid" } },
      });
      expect(env1.seq).toBe(1);

      const segmentPath = roomLogSegmentPath(room, 1);
      const tornLine = '{"seq":2,"broken\n';
      appendFileSync(segmentPath, tornLine, "utf8");

      const currentIndex = readLogIndex(room);
      writeLogIndex(room, {
        ...currentIndex,
        next_seq: 3,
      });

      const env3 = appendMessage(room, {
        sender,
        kind: "message",
        body: { schema: "text", data: { text: "msg-3-valid" } },
      });
      expect(env3.seq).toBe(3);

      const cursor = createInitialCursor(room, reader);
      const logDir = roomLogDir(room);
      const leaseResult = leaseNext(cursor, logDir, 50);

      expect(leaseResult.messages).toHaveLength(1);
      expect(leaseResult.messages[0]?.seq).toBe(1);
      expect(leaseResult.messages[0]?.body.data).toEqual({ text: "msg-1-valid" });

      const qDir = roomQuarantineDir(room);
      const qFiles = readdirSync(qDir).filter((file) => !file.startsWith("."));
      expect(qFiles.length).toBeGreaterThanOrEqual(1);

      const quarantineRecordPath = join(qDir, qFiles[0]!);
      const quarantineRecord = JSON.parse(readFileSync(quarantineRecordPath, "utf8")) as {
        readonly ts: string;
        readonly seq: number;
        readonly reason: string;
        readonly raw: string;
      };
      expect(quarantineRecord.raw).toBe('{"seq":2,"broken');
      expect(typeof quarantineRecord.reason).toBe("string");
      expect(quarantineRecord.reason.length).toBeGreaterThan(0);
    } finally {
      if (prevHome !== undefined) {
        process.env["CHATROOM_HOME"] = prevHome;
      } else {
        delete process.env["CHATROOM_HOME"];
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
