import { afterAll, describe, expect, it, spyOn } from "bun:test";
import { ChatVirtualFS } from "../../../src/testing/virtual-fs/index.ts";
import {
  BRIEF_SET_SCHEMA,
  TASK_NEW_SCHEMA,
  formatMineRecovery,
  scanMineRecovery,
  type MemberBriefRecord,
} from "../../../src/work/index.ts";
import { mineCommand } from "../../../src/cli/commands/index.ts";
import { appendToLog, createHealthPorts, seedRoom, VFS_PREFIX } from "./helpers.ts";

const mockFs = await import("node:fs");

describe("Recovery View Verbatim Brief Replay", () => {
  const vfs = new ChatVirtualFS();
  const ports = createHealthPorts(vfs);
  const previousChatroomHome = process.env.CHATROOM_HOME;
  process.env.CHATROOM_HOME = VFS_PREFIX;

  const originalExists = mockFs.existsSync;
  const originalRead = mockFs.readFileSync;
  const originalReaddir = mockFs.readdirSync;
  const originalStat = mockFs.statSync;

  spyOn(mockFs, "existsSync").mockImplementation((target: unknown): boolean => {
    const pathStr = String(target);
    return pathStr.startsWith(VFS_PREFIX)
      ? vfs.existsSync(pathStr)
      : originalExists(target as Parameters<typeof originalExists>[0]);
  });

  spyOn(mockFs, "readFileSync").mockImplementation(
    (target: unknown, options?: unknown): string | Buffer => {
      const pathStr = String(target);
      if (pathStr.startsWith(VFS_PREFIX)) {
        const res = vfs.readFileSync(pathStr, "utf8");
        return typeof res === "string" ? res : Buffer.from(res);
      }
      return originalRead(
        target as Parameters<typeof originalRead>[0],
        options as Parameters<typeof originalRead>[1],
      );
    },
  );

  spyOn(mockFs, "readdirSync").mockImplementation((target: unknown, options?: unknown): unknown => {
    const pathStr = String(target);
    return pathStr.startsWith(VFS_PREFIX)
      ? vfs.readdirSync(pathStr)
      : originalReaddir(
          target as Parameters<typeof originalReaddir>[0],
          options as Parameters<typeof originalReaddir>[1],
        );
  });

  spyOn(mockFs, "statSync").mockImplementation((target: unknown): unknown => {
    const pathStr = String(target);
    return pathStr.startsWith(VFS_PREFIX)
      ? vfs.statSync(pathStr)
      : originalStat(target as Parameters<typeof originalStat>[0]);
  });

  afterAll(() => {
    if (previousChatroomHome === undefined) {
      delete process.env.CHATROOM_HOME;
    } else {
      process.env.CHATROOM_HOME = previousChatroomHome;
    }
  });

  it("populates room.brief with MemberBriefRecord when present in scanMineRecovery", () => {
    seedRoom(vfs, "brief-alpha", ["alice"]);
    appendToLog(vfs, "brief-alpha", 1, BRIEF_SET_SCHEMA, {
      member_id: "alice",
      text: "Active goal: optimize compilation latency",
      updated_at: "2026-09-07T11:00:00.000Z",
    });

    const report = scanMineRecovery("alice", ports);
    expect(report.identity).toBe("alice");
    expect(report.rooms.length).toBeGreaterThanOrEqual(1);

    const room = report.rooms.find((r) => r.room === "brief-alpha");
    expect(room).toBeDefined();
    expect(room?.brief).not.toBeNull();
    expect(room?.brief?.member_id).toBe("alice");
    expect(room?.brief?.text).toBe("Active goal: optimize compilation latency");
    expect(room?.brief?.updated_at).toBe("2026-09-07T11:00:00.000Z");
    expect(room?.brief?.seq).toBe(1);

    expect(report.brief).not.toBeNull();
    expect(report.brief?.text).toBe("Active goal: optimize compilation latency");
  });

  it("renders the brief verbatim at the top of the room board in formatMineRecovery", () => {
    seedRoom(vfs, "brief-board", ["alice"]);
    appendToLog(vfs, "brief-board", 1, BRIEF_SET_SCHEMA, {
      member_id: "alice",
      text: "Working on memory management pipeline",
      updated_at: "2026-09-07T11:15:00.000Z",
    });
    appendToLog(
      vfs,
      "brief-board",
      2,
      TASK_NEW_SCHEMA,
      {
        id: "T-B01",
        title: "Track GC allocations",
        status: "open",
        assignee: "alice",
      },
      "Investigate GC spikes",
    );

    const report = scanMineRecovery("alice", ports);
    const room = report.rooms.find((r) => r.room === "brief-board");
    expect(room).toBeDefined();
    if (!room) return;

    const formattedRoom = formatMineRecovery(room);
    const expectedHeader = [
      "=== RECOVERY BRIEF (alice) ===",
      "Last updated: 2026-09-07T11:15:00.000Z",
      "Working on memory management pipeline",
      "=================================",
    ].join("\n");

    expect(formattedRoom.startsWith(expectedHeader)).toBe(true);

    const briefIndex = formattedRoom.indexOf("=== RECOVERY BRIEF (alice) ===");
    const taskIndex = formattedRoom.indexOf("T-B01");
    expect(briefIndex).toBe(0);
    expect(taskIndex).toBeGreaterThan(briefIndex);

    const formattedReport = formatMineRecovery(report);
    expect(formattedReport.includes(expectedHeader)).toBe(true);
    const reportBriefIndex = formattedReport.indexOf("=== RECOVERY BRIEF (alice) ===");
    const reportTaskIndex = formattedReport.indexOf("T-B01");
    expect(reportBriefIndex).toBeLessThan(reportTaskIndex);
  });

  it("preserves multi-line and special characters verbatim with exact byte-identical reproduction", () => {
    seedRoom(vfs, "brief-verbatim", ["alice"]);
    const multilineSpecialText = [
      "Line 1: High priority fix",
      "",
      "  Line 3: indented with 2 spaces",
      "\tLine 4: indented with tab",
      "Special chars: !@#$%^&*()_+-=[]{}|;':\",.<>/?`~",
      "Unicode & Emoji: 🚀 ⚡ 🛠️ 🎯",
      "Trailing spaces line   ",
      "Final line without newline",
    ].join("\n");

    appendToLog(vfs, "brief-verbatim", 1, BRIEF_SET_SCHEMA, {
      member_id: "alice",
      text: multilineSpecialText,
      updated_at: "2026-09-07T11:30:00.000Z",
    });

    const report = scanMineRecovery("alice", ports);
    const room = report.rooms.find((r) => r.room === "brief-verbatim");
    expect(room).toBeDefined();
    if (!room) return;

    expect(room.brief?.text).toBe(multilineSpecialText);

    const formattedRoom = formatMineRecovery(room);
    const startTag = "Last updated: 2026-09-07T11:30:00.000Z\n";
    const endTag = "\n=================================";
    const startIndex = formattedRoom.indexOf(startTag) + startTag.length;
    const endIndex = formattedRoom.indexOf(endTag, startIndex);

    expect(startIndex).toBeGreaterThan(0);
    expect(endIndex).toBeGreaterThan(startIndex);

    const extractedText = formattedRoom.substring(startIndex, endIndex);
    expect(extractedText).toBe(multilineSpecialText);
  });

  it("renders proper [NOTICE] when no brief is recorded for a member in a room", () => {
    seedRoom(vfs, "brief-empty-room", ["charlie"]);
    const report = scanMineRecovery("charlie", ports);
    const room = report.rooms.find((r) => r.room === "brief-empty-room");
    expect(room).toBeDefined();
    if (!room) return;

    expect(room.brief).toBeNull();

    const formattedRoom = formatMineRecovery(room);
    const expectedNotice =
      "[NOTICE] No recovery brief set for charlie in room brief-empty-room. Run 'chat brief --set <text>' to record context.";
    expect(formattedRoom.startsWith(expectedNotice)).toBe(true);

    const formattedReport = formatMineRecovery(report);
    expect(formattedReport.includes(expectedNotice)).toBe(true);
  });

  it("reflects newest brief sequence dynamically in chat mine CLI execution", async () => {
    seedRoom(vfs, "brief-dynamic", ["alice"]);
    appendToLog(vfs, "brief-dynamic", 1, BRIEF_SET_SCHEMA, {
      member_id: "alice",
      text: "Phase 1: Initial codebase reconnaissance",
      updated_at: "2026-09-07T11:40:00.000Z",
    });

    const result1 = await mineCommand({ as: "alice", json: true }, { ports }, []);
    const md1 = String(result1["markdown"]);
    expect(md1.includes("Phase 1: Initial codebase reconnaissance")).toBe(true);
    expect(md1.includes("=== RECOVERY BRIEF (alice) ===")).toBe(true);

    appendToLog(vfs, "brief-dynamic", 2, BRIEF_SET_SCHEMA, {
      member_id: "alice",
      text: "Phase 2: Refactoring complete, verifying test suite",
      updated_at: "2026-09-07T11:45:00.000Z",
    });

    const result2 = await mineCommand({ as: "alice", json: true }, { ports }, []);
    const md2 = String(result2["markdown"]);
    expect(md2.includes("Phase 2: Refactoring complete, verifying test suite")).toBe(true);
    expect(md2.includes("Phase 1: Initial codebase reconnaissance")).toBe(false);
    expect(md2.includes("Last updated: 2026-09-07T11:45:00.000Z")).toBe(true);

    const briefRecord = result2["brief"] as MemberBriefRecord | null;
    expect(briefRecord).not.toBeNull();
    expect(briefRecord?.seq).toBe(2);
  });
});
