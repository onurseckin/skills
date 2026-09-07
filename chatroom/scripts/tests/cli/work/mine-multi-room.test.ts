import { afterAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { dirname } from "node:path";
import { roomMemberPath, type MemberRecord } from "../../../src/core/index.ts";
import { ChatVirtualFS } from "../../../src/testing/virtual-fs/index.ts";
import {
  BRIEF_SET_SCHEMA,
  TASK_NEW_SCHEMA,
  TASK_STATUS_SCHEMA,
  clearWorkItemsCache,
  formatMineRecovery,
  scanMineRecovery,
  type ExtendedHealthPorts,
} from "../../../src/work/index.ts";
import { chatMineCommand } from "../../../src/cli/commands/index.ts";
import { appendToLog, createHealthPorts, seedRoom, VFS_PREFIX } from "./index.ts";

const mockFs = await import("node:fs");

interface MultiRoomPorts extends ExtendedHealthPorts {
  readonly fs: ChatVirtualFS;
  readonly env: typeof process.env;
  readonly cwd: string;
}

describe("Multi-Room Aggregation Recovery View", () => {
  let vfs = new ChatVirtualFS();
  let ports: MultiRoomPorts = {
    ...createHealthPorts(vfs),
    fs: vfs,
    env: process.env,
    cwd: VFS_PREFIX,
  };

  const previousChatroomHome = process.env.CHATROOM_HOME;
  process.env.CHATROOM_HOME = VFS_PREFIX;

  const originalExists = mockFs.existsSync;
  const originalRead = mockFs.readFileSync;
  const originalReaddir = mockFs.readdirSync;
  const originalStat = mockFs.statSync;

  const existsSpy = spyOn(mockFs, "existsSync").mockImplementation((target: unknown): boolean => {
    const pathStr = String(target);
    return pathStr.startsWith(VFS_PREFIX)
      ? vfs.existsSync(pathStr)
      : originalExists(target as Parameters<typeof originalExists>[0]);
  });

  const readSpy = spyOn(mockFs, "readFileSync").mockImplementation(
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

  const readdirSpy = spyOn(mockFs, "readdirSync").mockImplementation(
    (target: unknown, options?: unknown): unknown => {
      const pathStr = String(target);
      return pathStr.startsWith(VFS_PREFIX)
        ? vfs.readdirSync(pathStr)
        : originalReaddir(
            target as Parameters<typeof originalReaddir>[0],
            options as Parameters<typeof originalReaddir>[1],
          );
    },
  );

  const statSpy = spyOn(mockFs, "statSync").mockImplementation((target: unknown): unknown => {
    const pathStr = String(target);
    return pathStr.startsWith(VFS_PREFIX)
      ? vfs.statSync(pathStr)
      : originalStat(target as Parameters<typeof originalStat>[0]);
  });

  afterAll(() => {
    process.env.CHATROOM_HOME = previousChatroomHome;
    existsSpy.mockRestore();
    readSpy.mockRestore();
    readdirSpy.mockRestore();
    statSpy.mockRestore();
  });

  function seedMember(room: string, memberId: string): void {
    const memberPath = roomMemberPath(room, memberId);
    vfs.mkdirSync(dirname(memberPath), { recursive: true });
    const record: MemberRecord = {
      v: 1,
      id: memberId,
      display_name: memberId,
      role: "worker",
      host: "local",
      joined_at: "2026-09-07T10:00:00.000Z",
      key_fingerprint: "sha256:12345678",
      aliases: [],
    };
    vfs.writeFileSync(memberPath, JSON.stringify(record, null, 2));
  }

  beforeEach(() => {
    vfs = new ChatVirtualFS();
    ports = {
      ...createHealthPorts(vfs),
      fs: vfs,
      env: process.env,
      cwd: VFS_PREFIX,
    };
    clearWorkItemsCache();

    seedRoom(vfs, "room-alpha");
    seedRoom(vfs, "room-beta");
    seedMember("room-alpha", "member-1");
    seedMember("room-beta", "member-1");

    appendToLog(vfs, "room-alpha", 1, BRIEF_SET_SCHEMA, {
      member_id: "member-1",
      text: "Alpha brief: stabilize parser pipeline",
      updated_at: "2026-09-07T10:00:00.000Z",
    });
    appendToLog(
      vfs,
      "room-alpha",
      2,
      TASK_NEW_SCHEMA,
      {
        id: "alpha-task-1",
        title: "Alpha Task One",
        status: "open",
        assignee: "member-1",
      },
      "Alpha task 1 details",
    );
    appendToLog(
      vfs,
      "room-alpha",
      3,
      TASK_NEW_SCHEMA,
      {
        id: "alpha-task-2",
        title: "Alpha Task Two",
        status: "open",
        assignee: "member-1",
      },
      "Alpha task 2 details",
    );

    appendToLog(vfs, "room-beta", 1, BRIEF_SET_SCHEMA, {
      member_id: "member-1",
      text: "Beta brief: audit security sandboxes",
      updated_at: "2026-09-07T11:00:00.000Z",
    });
    appendToLog(
      vfs,
      "room-beta",
      2,
      TASK_NEW_SCHEMA,
      {
        id: "beta-task-1",
        title: "Beta Task One",
        status: "open",
        assignee: "member-1",
      },
      "Beta task 1 details",
    );
  });

  it("scans multi-room recovery report with distinct tasks and briefs", () => {
    const report = scanMineRecovery("member-1", ports);

    expect(report.rooms.length).toBe(2);

    const alpha = report.rooms.find((r) => r.room === "room-alpha");
    const beta = report.rooms.find((r) => r.room === "room-beta");

    expect(alpha).toBeDefined();
    expect(beta).toBeDefined();

    expect(alpha?.brief).not.toBeNull();
    expect(alpha?.brief?.text).toBe("Alpha brief: stabilize parser pipeline");
    expect(alpha?.brief?.member_id).toBe("member-1");

    expect(beta?.brief).not.toBeNull();
    expect(beta?.brief?.text).toBe("Beta brief: audit security sandboxes");
    expect(beta?.brief?.member_id).toBe("member-1");

    expect(alpha?.items.map((i) => i.id)).toEqual(["alpha-task-1", "alpha-task-2"]);
    expect(beta?.items.map((i) => i.id)).toEqual(["beta-task-1"]);

    expect(alpha?.total_open).toBe(2);
    expect(beta?.total_open).toBe(1);
    expect(report.total_open).toBe(3);
  });

  it("renders both room sections tagged with room identifiers and briefs above tasks in formatMineRecovery and chatMineCommand", async () => {
    const report = scanMineRecovery("member-1", ports);

    const formattedReport = formatMineRecovery(report);
    expect(formattedReport.includes("Alpha brief: stabilize parser pipeline")).toBe(true);
    expect(formattedReport.includes("Beta brief: audit security sandboxes")).toBe(true);
    expect(formattedReport.includes("Room: room-alpha")).toBe(true);
    expect(formattedReport.includes("Room: room-beta")).toBe(true);

    const alphaBriefIdx = formattedReport.indexOf("Alpha brief: stabilize parser pipeline");
    const betaBriefIdx = formattedReport.indexOf("Beta brief: audit security sandboxes");
    const alphaTask1Idx = formattedReport.indexOf("alpha-task-1");
    const alphaTask2Idx = formattedReport.indexOf("alpha-task-2");
    const betaTask1Idx = formattedReport.indexOf("beta-task-1");

    expect(alphaBriefIdx).toBeLessThan(alphaTask1Idx);
    expect(alphaBriefIdx).toBeLessThan(alphaTask2Idx);
    expect(betaBriefIdx).toBeLessThan(betaTask1Idx);

    const alphaRoom = report.rooms.find((r) => r.room === "room-alpha");
    const betaRoom = report.rooms.find((r) => r.room === "room-beta");
    expect(alphaRoom).toBeDefined();
    expect(betaRoom).toBeDefined();
    if (!alphaRoom || !betaRoom) return;

    const formattedAlpha = formatMineRecovery(alphaRoom);
    expect(formattedAlpha.includes("Room: room-alpha")).toBe(true);
    expect(formattedAlpha.includes("room-beta")).toBe(false);
    expect(formattedAlpha.indexOf("Alpha brief: stabilize parser pipeline")).toBeLessThan(
      formattedAlpha.indexOf("alpha-task-1"),
    );

    const formattedBeta = formatMineRecovery(betaRoom);
    expect(formattedBeta.includes("Room: room-beta")).toBe(true);
    expect(formattedBeta.includes("room-alpha")).toBe(false);
    expect(formattedBeta.indexOf("Beta brief: audit security sandboxes")).toBeLessThan(
      formattedBeta.indexOf("beta-task-1"),
    );

    const commandResult = await chatMineCommand({ as: "member-1", json: true }, { ports }, []);
    const markdown = String(commandResult["markdown"]);
    expect(markdown.includes("Room: room-alpha")).toBe(true);
    expect(markdown.includes("Room: room-beta")).toBe(true);
    expect(markdown.indexOf("Alpha brief: stabilize parser pipeline")).toBeLessThan(
      markdown.indexOf("alpha-task-1"),
    );
    expect(markdown.indexOf("Beta brief: audit security sandboxes")).toBeLessThan(
      markdown.indexOf("beta-task-1"),
    );
  });

  it("completing a task in room-alpha updates only room-alpha without altering room-beta", async () => {
    appendToLog(vfs, "room-alpha", 4, TASK_STATUS_SCHEMA, {
      id: "alpha-task-1",
      status: "done",
    });

    const report = scanMineRecovery("member-1", ports);
    expect(report.rooms.length).toBe(2);

    const alpha = report.rooms.find((r) => r.room === "room-alpha");
    const beta = report.rooms.find((r) => r.room === "room-beta");

    expect(alpha).toBeDefined();
    expect(beta).toBeDefined();

    expect(alpha?.items.map((i) => i.id)).toEqual(["alpha-task-2"]);
    expect(alpha?.total_open).toBe(1);
    expect(alpha?.brief?.text).toBe("Alpha brief: stabilize parser pipeline");

    expect(beta?.items.map((i) => i.id)).toEqual(["beta-task-1"]);
    expect(beta?.total_open).toBe(1);
    expect(beta?.brief?.text).toBe("Beta brief: audit security sandboxes");

    expect(report.total_open).toBe(2);

    const formatted = formatMineRecovery(report);
    expect(formatted.includes("alpha-task-1")).toBe(false);
    expect(formatted.includes("alpha-task-2")).toBe(true);
    expect(formatted.includes("beta-task-1")).toBe(true);

    const commandResult = await chatMineCommand({ as: "member-1", json: true }, { ports }, []);
    const markdown = String(commandResult["markdown"]);
    expect(markdown.includes("alpha-task-1")).toBe(false);
    expect(markdown.includes("alpha-task-2")).toBe(true);
    expect(markdown.includes("beta-task-1")).toBe(true);
  });
});
