import { afterAll, describe, expect, it, spyOn } from "bun:test";
import { dirname, join } from "node:path";
import {
  daemonHealthPath,
  roomLogIndexPath,
  roomLogSegmentPath,
  type Envelope,
  type LogIndex,
  type UnsignedEnvelope,
} from "../../../src/core/index.ts";
import { signEnvelope } from "../../../src/crypto/index.ts";
import { type DaemonHealthRecord } from "../../../src/daemon/index.ts";
import { ChatVirtualFS } from "../../../src/testing/virtual-fs/index.ts";
import {
  TASK_ACCEPTED_SCHEMA,
  TASK_NEW_SCHEMA,
  TASK_NOTE_SCHEMA,
  scanMineRecovery,
  type ExtendedHealthPorts,
} from "../../../src/work/index.ts";
import { mineCommand } from "../../../src/cli/commands/index.ts";
import { mineSpec } from "../../../src/cli/registry/index.ts";

import {
  appendToLog,
  createHealthPorts,
  makeEnvelope,
  seedMember,
  seedRoom,
  VFS_PREFIX,
} from "./helpers.ts";

const mockFs = await import("node:fs");

describe("Recovery View: chat mine and scanMineRecovery", () => {
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

  it("verifies mineSpec schema and properties", () => {
    expect(mineSpec.name).toBe("chat:mine");
    expect(mineSpec.aliases).toContain("mine");
    expect(mineSpec.readsStdin).toBe(false);
    expect(mineSpec.takesRemainder).toBe(false);
    expect(mineSpec.handler).toBe(mineCommand);

    const flagNames = mineSpec.flags.map((f) => f.name);
    expect(flagNames).toEqual(["as", "json"]);
    expect(mineSpec.flags.find((f) => f.name === "as")?.required).toBe(false);
    expect(mineSpec.flags.find((f) => f.name === "json")?.required).toBe(false);
  });

  it("scans across 3 simulated rooms, grouping by status and detecting unseen items", () => {
    seedRoom(vfs, "core-dev", ["alice", "bob"]);
    seedRoom(vfs, "qa-lane", ["alice"]);
    seedRoom(vfs, "ops-cluster", ["alice"]);

    appendToLog(
      vfs,
      "core-dev",
      1,
      TASK_NEW_SCHEMA,
      {
        id: "T-101",
        title: "Implement cache layer",
        status: "in_progress",
        assignee: "alice",
      },
      "Starting cache work",
    );
    appendToLog(vfs, "core-dev", 2, TASK_ACCEPTED_SCHEMA, {
      id: "T-101",
      accepted_at: "2026-09-07T10:05:00.000Z",
    });
    appendToLog(vfs, "core-dev", 3, TASK_NOTE_SCHEMA, {
      id: "T-101",
      text: "Working on cache invalidation",
      author: "alice",
    });
    appendToLog(
      vfs,
      "core-dev",
      4,
      TASK_NEW_SCHEMA,
      {
        id: "T-102",
        title: "Fix memory leak",
        status: "open",
        assignee: "alice",
      },
      "Please investigate heap profile",
    );
    appendToLog(
      vfs,
      "core-dev",
      5,
      TASK_NEW_SCHEMA,
      {
        id: "T-103",
        title: "Update build scripts",
        status: "open",
        assignee: "bob",
      },
      "Task for bob",
    );

    appendToLog(
      vfs,
      "qa-lane",
      1,
      TASK_NEW_SCHEMA,
      {
        id: "T-201",
        title: "Test coverage audit",
        status: "review",
        assignee: "alice",
      },
      "Need test review",
    );
    appendToLog(vfs, "qa-lane", 2, TASK_ACCEPTED_SCHEMA, {
      id: "T-201",
      accepted_at: "2026-09-07T10:10:00.000Z",
    });
    appendToLog(vfs, "qa-lane", 3, TASK_NOTE_SCHEMA, {
      id: "T-201",
      text: "Ready for QA sign-off",
      author: "alice",
    });
    appendToLog(
      vfs,
      "qa-lane",
      4,
      TASK_NEW_SCHEMA,
      {
        id: "T-202",
        title: "E2E regression suite",
        status: "done",
        assignee: "alice",
      },
      "All tests green",
    );
    appendToLog(
      vfs,
      "qa-lane",
      5,
      TASK_NEW_SCHEMA,
      {
        id: "T-203",
        title: "Deprecated spike",
        status: "dropped",
        assignee: "alice",
      },
      "Cancelled effort",
    );

    appendToLog(
      vfs,
      "ops-cluster",
      1,
      TASK_NEW_SCHEMA,
      {
        id: "T-301",
        title: "Upgrade container base image",
        status: "blocked",
        assignee: "alice",
      },
      "Security update",
    );
    appendToLog(vfs, "ops-cluster", 2, TASK_ACCEPTED_SCHEMA, {
      id: "T-301",
      accepted_at: "2026-09-07T10:15:00.000Z",
    });
    appendToLog(vfs, "ops-cluster", 3, TASK_NOTE_SCHEMA, {
      id: "T-301",
      text: "Blocked on upstream glibc patch",
      author: "alice",
    });
    appendToLog(
      vfs,
      "ops-cluster",
      4,
      TASK_NEW_SCHEMA,
      {
        id: "T-302",
        title: "Rotate telemetry secrets",
        status: "open",
        assignee: "alice",
      },
      "Unacknowledged secret rotation",
    );

    const report = scanMineRecovery("alice", ports);

    expect(report.identity).toBe("alice");
    expect(report.total_open).toBe(5);

    expect(report.items_by_status.in_progress.map((i) => i.id)).toEqual(["T-101"]);
    expect(report.items_by_status.review.map((i) => i.id)).toEqual(["T-201"]);
    expect(report.items_by_status.blocked.map((i) => i.id)).toEqual(["T-301"]);
    expect(report.items_by_status.open.map((i) => i.id)).toEqual(["T-102", "T-302"]);

    expect(report.unseen.map((i) => i.id)).toEqual(["T-102", "T-302"]);
    expect(report.unseen.every((i) => i.accepted_at === null)).toBe(true);

    const t101 = report.items_by_status.in_progress[0];
    expect(t101?.room).toBe("core-dev");
    expect(t101?.title).toBe("Implement cache layer");
    expect(t101?.last_thread_message).toBe("Working on cache invalidation");
    expect(t101?.accepted_at).toBe("2026-09-07T10:05:00.000Z");

    const t201 = report.items_by_status.review[0];
    expect(t201?.room).toBe("qa-lane");
    expect(t201?.title).toBe("Test coverage audit");
    expect(t201?.last_thread_message).toBe("Ready for QA sign-off");

    const t301 = report.items_by_status.blocked[0];
    expect(t301?.room).toBe("ops-cluster");
    expect(t301?.title).toBe("Upgrade container base image");
    expect(t301?.last_thread_message).toBe("Blocked on upstream glibc patch");

    const t102 = report.items_by_status.open.find((i) => i.id === "T-102");
    expect(t102?.last_thread_message).toBe("Please investigate heap profile");

    const t302 = report.items_by_status.open.find((i) => i.id === "T-302");
    expect(t302?.last_thread_message).toBe("Unacknowledged secret rotation");

    const bobReport = scanMineRecovery("bob", ports);
    expect(bobReport.identity).toBe("bob");
    expect(bobReport.total_open).toBe(1);
    expect(bobReport.items_by_status.open.map((i) => i.id)).toEqual(["T-103"]);
  });

  it("detects unseen item resolution via C1 daemon consumer receipt", () => {
    const healthPath = daemonHealthPath("core-dev", "alice");
    const healthRecord: DaemonHealthRecord = {
      v: 1,
      room: "core-dev",
      reader: "alice",
      pid: 1234,
      start_time: "2026-09-07T10:00:00.000Z",
      boot_id: "boot-1",
      state: "LIVE",
      last_wake_at: "2026-09-07T10:20:00.000Z",
      last_wake_source: "poll",
      last_delivered_seq: 10,
      room_head_seq: 10,
      lag_seqs: 0,
      watch_active: true,
      watch_failures: 0,
      poll_interval_ms: 1000,
      spool_bytes: 0,
      spool_lines: 0,
      consumer_last_ack_at: "2026-09-07T10:20:00.000Z",
      consumer_last_delivered_seq: 10,
      consumer_lag_ms: 0,
      respawns_this_hour: 0,
      errors_recent: [],
    };
    vfs.mkdirSync(dirname(healthPath), { recursive: true });
    vfs.writeFileSync(healthPath, JSON.stringify(healthRecord, null, 2));

    const reportAfterReceipt = scanMineRecovery("alice", ports);
    expect(reportAfterReceipt.total_open).toBe(5);
    expect(reportAfterReceipt.unseen.map((i) => i.id)).toEqual(["T-302"]);

    const t102 = reportAfterReceipt.items_by_status.open.find((i) => i.id === "T-102");
    expect(t102?.accepted_at).toBe("2026-09-07T10:20:00.000Z");
  });

  it("executes mineCommand with --json and validates machine output structure", async () => {
    const result = await mineCommand({ as: "alice", json: true }, { ports }, []);

    expect(result["identity"]).toBe("alice");
    expect(result["total_open"]).toBe(5);

    const itemsByStatus = result["items_by_status"] as Record<string, unknown[]>;
    expect(itemsByStatus).toBeDefined();
    expect(itemsByStatus["in_progress"]?.length).toBe(1);
    expect(itemsByStatus["review"]?.length).toBe(1);
    expect(itemsByStatus["blocked"]?.length).toBe(1);
    expect(itemsByStatus["open"]?.length).toBe(2);

    const unseen = result["unseen"] as unknown[];
    expect(Array.isArray(unseen)).toBe(true);
    expect(unseen.length).toBe(1);

    const md = String(result["markdown"]);
    expect(md.includes("Recovery View: alice (5 open items)")).toBe(true);
    expect(md.includes("core-dev")).toBe(true);
    expect(md.includes("qa-lane")).toBe(true);
    expect(md.includes("ops-cluster")).toBe(true);
    expect(md.includes("T-101")).toBe(true);
    expect(md.includes("T-301")).toBe(true);
    expect(md.includes("Last Thread Message:")).toBe(true);
    expect(md.includes("UNSEEN WORK ITEMS")).toBe(true);
  });

  it("returns zero open items for an unknown identity", () => {
    const unknownReport = scanMineRecovery("unknown-agent", ports);
    expect(unknownReport.identity).toBe("unknown-agent");
    expect(unknownReport.total_open).toBe(0);
    expect(unknownReport.unseen).toEqual([]);
    expect(unknownReport.items_by_status.open).toEqual([]);
    expect(unknownReport.items_by_status.in_progress).toEqual([]);
    expect(unknownReport.items_by_status.review).toEqual([]);
    expect(unknownReport.items_by_status.blocked).toEqual([]);
  });

  it("filters non-member rooms without leaking mentions or notices in chat mine", async () => {
    seedRoom(vfs, "room-alpha", ["dave"]);
    seedRoom(vfs, "room-beta");
    appendToLog(vfs, "room-alpha", 1, TASK_NEW_SCHEMA, {
      id: "T-A01",
      title: "Alpha Task",
      status: "open",
      assignee: "dave",
    });
    appendToLog(vfs, "room-beta", 1, TASK_NEW_SCHEMA, {
      id: "T-B01",
      title: "Beta Task",
      status: "open",
      assignee: "dave",
    });

    const report = scanMineRecovery("dave", ports);
    expect(report.rooms.map((r) => r.room)).toContain("room-alpha");
    expect(report.rooms.map((r) => r.room)).not.toContain("room-beta");

    const result = await mineCommand({ as: "dave" }, { ports }, []);
    const markdown = String(result["markdown"]);
    expect(markdown).toContain("room-alpha");
    expect(markdown).not.toContain("room-beta");
    expect(markdown).not.toContain("[NOTICE] No recovery brief set for dave in room room-beta");
  });
});
