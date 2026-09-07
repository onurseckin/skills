import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { doctorCommand } from "../../chatroom/scripts/src/cli/commands/doctor.ts";
import { stepDaemonLoop } from "../../chatroom/scripts/src/daemon/loop.ts";
import { appendMessage } from "../../chatroom/scripts/src/log/append.ts";
import { addMember } from "../../chatroom/scripts/src/room/index.ts";
import { loadCursor, leaseNext } from "../../chatroom/scripts/src/cursor/index.ts";
import { readerCursorPath, roomLogDir } from "../../chatroom/scripts/src/core/paths.ts";
import { cleanupVirtualChatroomFS, createTestRoom, setupVirtualChatroomFS } from "./helpers.ts";

beforeEach(() => {
  setupVirtualChatroomFS();
});

afterEach(() => {
  cleanupVirtualChatroomFS();
});

describe("daemon contiguous sequence ack and truthful quarantine reporting", () => {
  it("advances contiguous_seq to first verified message only, blocks cursor advance, redelivers third message, and reports quarantine in doctor", async () => {
    const room = "contiguous-ack-test-room";
    const reader = "agent-reader";

    createTestRoom({
      id: room,
      title: "Contiguous Ack Test Room",
      visibility: "public",
      createdBy: reader,
    });
    addMember(room, {
      id: reader,
      role: "agent",
      host: "antigravity",
    });

    const sender = { id: reader, role: "agent", host: "antigravity" };
    const env1 = appendMessage(room, {
      sender,
      kind: "chat",
      body: { schema: "text", data: { text: "msg-1-valid" } },
    });
    const env2 = appendMessage(
      room,
      {
        sender,
        kind: "chat",
        body: { schema: "text", data: { text: "msg-2-bad-sig" } },
      },
      "invalid-key-for-msg-2",
    );
    const env3 = appendMessage(room, {
      sender,
      kind: "chat",
      body: { schema: "text", data: { text: "msg-3-valid" } },
    });

    expect(env1.seq).toBe(1);
    expect(env2.seq).toBe(2);
    expect(env3.seq).toBe(3);

    const initialNow = "2026-09-07T10:00:00.000Z";
    const step1 = stepDaemonLoop({
      room,
      reader,
      now: initialNow,
    });

    expect(step1.delivered).toBe(1);
    expect(step1.remaining).toBe(2);

    const cursorPath = readerCursorPath(room, reader);
    const { cursor: cursorAfterStep1 } = loadCursor(cursorPath);

    expect(cursorAfterStep1.contiguous_seq).toBe(1);
    expect(cursorAfterStep1.acked_above).toEqual([]);
    expect(cursorAfterStep1.held).toHaveLength(1);
    expect(cursorAfterStep1.held[0]?.from).toBe(2);
    expect(cursorAfterStep1.held[0]?.to).toBe(3);

    const futureNow = "2026-09-07T11:00:00.000Z";
    const logDir = roomLogDir(room);
    const leaseRes2 = leaseNext(cursorAfterStep1, logDir, 10, { now: futureNow });

    expect(leaseRes2.messages).toHaveLength(2);
    expect(leaseRes2.messages.map((m) => m.seq)).toEqual([2, 3]);

    const redelivered3 = leaseRes2.messages.find((m) => m.seq === 3);
    expect(redelivered3).toBeDefined();
    expect(redelivered3?.redelivery_count).toBeGreaterThanOrEqual(1);

    const step2 = stepDaemonLoop({
      room,
      reader,
      now: futureNow,
    });
    expect(step2.delivered).toBe(0);

    const { cursor: cursorAfterStep2 } = loadCursor(cursorPath);
    expect(cursorAfterStep2.contiguous_seq).toBe(1);

    const doctorResult = await doctorCommand({ room });
    expect(doctorResult.is_healthy).toBe(false);
    expect(doctorResult.total_issues).toBeGreaterThanOrEqual(1);
    expect(doctorResult.rooms).toHaveLength(1);

    const roomReport = doctorResult.rooms[0];
    expect(roomReport).toBeDefined();
    if (roomReport) {
      expect(roomReport.quarantined).toBeGreaterThanOrEqual(1);
      expect(roomReport.quarantined_count).toBeGreaterThanOrEqual(1);
      expect(roomReport.quarantined_lines.length).toBeGreaterThanOrEqual(1);
    }
    expect(doctorResult.markdown).toContain("Quarantined");
    expect(doctorResult.markdown).toContain("WARNING");
  });

  it("does not call ackLease and does not advance contiguous_seq when first envelope in batch fails verification", async () => {
    const room = "first-poisoned-test-room";
    const reader = "agent-reader-2";

    createTestRoom({
      id: room,
      title: "First Poisoned Test Room",
      visibility: "public",
      createdBy: reader,
    });
    addMember(room, {
      id: reader,
      role: "agent",
      host: "antigravity",
    });

    const sender = { id: reader, role: "agent", host: "antigravity" };
    appendMessage(
      room,
      {
        sender,
        kind: "chat",
        body: { schema: "text", data: { text: "msg-1-bad-sig" } },
      },
      "invalid-key-for-msg-1",
    );
    appendMessage(room, {
      sender,
      kind: "chat",
      body: { schema: "text", data: { text: "msg-2-valid" } },
    });

    const initialNow = "2026-09-07T10:00:00.000Z";
    const step1 = stepDaemonLoop({
      room,
      reader,
      now: initialNow,
    });

    expect(step1.delivered).toBe(0);

    const cursorPath = readerCursorPath(room, reader);
    const { cursor: cursorAfterStep1 } = loadCursor(cursorPath);
    expect(cursorAfterStep1.contiguous_seq).toBe(0);
    expect(cursorAfterStep1.held).toHaveLength(1);
    expect(cursorAfterStep1.held[0]?.from).toBe(1);
    expect(cursorAfterStep1.held[0]?.to).toBe(2);

    const futureNow = "2026-09-07T11:00:00.000Z";
    const logDir = roomLogDir(room);
    const leaseRes2 = leaseNext(cursorAfterStep1, logDir, 10, { now: futureNow });
    expect(leaseRes2.messages).toHaveLength(2);
    expect(leaseRes2.messages.map((m) => m.seq)).toEqual([1, 2]);

    const doctorResult = await doctorCommand({ room });
    expect(doctorResult.is_healthy).toBe(false);
    expect(doctorResult.rooms[0]?.quarantined).toBeGreaterThanOrEqual(1);
  });
});
