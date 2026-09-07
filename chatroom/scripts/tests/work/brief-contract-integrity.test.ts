import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  ChatError,
  roomLogSegmentPath,
  roomMemberPath,
  timingSafeEqualBuffers,
  type Envelope,
} from "../../src/core/index.ts";
import { type MemberRecord } from "../../src/room/index.ts";
import { ChatVirtualFS } from "../../src/testing/virtual-fs/index.ts";
import {
  BRIEF_SET_SCHEMA,
  clearWorkItemsCache,
  extractMemberBrief,
  formatMineRecovery,
  getWorkCachePath,
  scanMineRecovery,
  TASK_NEW_SCHEMA,
  type ExtendedHealthPorts,
  type MemberBriefRecord,
} from "../../src/work/index.ts";
import {
  appendToVirtualLog,
  assertCanPerformWork,
  createHealthPorts,
  joinRoomWithBriefContract,
  makeEnvelope,
  readVirtualLogEnvelopes,
  seedExistingMember,
  seedRoom,
  type JoinContractInput,
  type JoinContractResult,
} from "./brief-helpers.ts";

const VFS_ROOT = "/virtual/agents/chatroom";

describe("Brief Contract Integrity Suite (Lane B4)", () => {
  const originalHome = process.env.CHATROOM_HOME;
  beforeAll(() => {
    process.env.CHATROOM_HOME = VFS_ROOT;
  });
  afterAll(() => {
    if (originalHome === undefined) {
      delete process.env.CHATROOM_HOME;
    } else {
      process.env.CHATROOM_HOME = originalHome;
    }
  });

  it("Property 1: Refusal on new member join without brief", () => {
    const vfs = new ChatVirtualFS();
    const room = "alpha-join-room";
    seedRoom(vfs, room);
    let errMissing: ChatError | null = null;
    try {
      joinRoomWithBriefContract(vfs, { room, as: "fresh-agent" });
    } catch (err: unknown) {
      if (err instanceof ChatError) errMissing = err;
    }
    expect(errMissing?.code).toBe("INVALID_ARGUMENT");

    let errEmpty: ChatError | null = null;
    try {
      joinRoomWithBriefContract(vfs, { room, as: "fresh-agent", brief: "   " });
    } catch (err: unknown) {
      if (err instanceof ChatError) errEmpty = err;
    }
    expect(errEmpty?.code).toBe("INVALID_ARGUMENT");
  });

  it("Property 1 VACUITY PROOF: Providing brief passes green and joins member", () => {
    const vfs = new ChatVirtualFS();
    const room = "alpha-join-room";
    seedRoom(vfs, room);

    const result = joinRoomWithBriefContract(vfs, {
      room,
      as: "fresh-agent",
      brief: "Ready to implement core protocols",
    });

    expect(result.joined).toBe(true);
    expect(result.grandfathered).toBe(false);
    expect(result.briefRecord?.member_id).toBe("fresh-agent");
    expect(result.briefRecord?.text).toBe("Ready to implement core protocols");
    expect(vfs.existsSync(roomMemberPath(room, "fresh-agent"))).toBe(true);

    const envelopes = readVirtualLogEnvelopes(vfs, room);
    const extracted = extractMemberBrief(envelopes, "fresh-agent");
    expect(extracted?.text).toBe("Ready to implement core protocols");
  });

  it("Property 2: Existing member grandfathering invariant", () => {
    const vfs = new ChatVirtualFS();
    const room = "beta-existing-room";
    seedRoom(vfs, room);
    seedExistingMember(vfs, room, "veteran-agent");

    const result = joinRoomWithBriefContract(vfs, { room, as: "veteran-agent" });
    expect(result.joined).toBe(true);
    expect(result.grandfathered).toBe(true);
    expect(result.briefRecord).toBeNull();
    expect(assertCanPerformWork(vfs, room, "veteran-agent")).toBe(true);
  });

  it("Property 2 VACUITY PROOF: Removing member file causes join without brief to fail red", () => {
    const vfs = new ChatVirtualFS();
    const room = "beta-existing-room";
    seedRoom(vfs, room);
    seedExistingMember(vfs, room, "veteran-agent");

    const memberPath = roomMemberPath(room, "veteran-agent");
    expect(vfs.existsSync(memberPath)).toBe(true);
    vfs.unlinkSync(memberPath);
    expect(vfs.existsSync(memberPath)).toBe(false);

    let errJoin: ChatError | null = null;
    try {
      joinRoomWithBriefContract(vfs, { room, as: "veteran-agent" });
    } catch (err: unknown) {
      if (err instanceof ChatError) errJoin = err;
    }
    expect(errJoin?.code).toBe("INVALID_ARGUMENT");

    let errWork: ChatError | null = null;
    try {
      assertCanPerformWork(vfs, room, "veteran-agent");
    } catch (err: unknown) {
      if (err instanceof ChatError) errWork = err;
    }
    expect(errWork?.code).toBe("NOT_MEMBER");
  });

  it("Property 3: Verbatim replay byte-identical invariant in formatMineRecovery", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const room = "brief-replay-room";
    seedRoom(vfs, room);
    seedExistingMember(vfs, room, "agent-special");

    const multilineBrief =
      "=== MISSION BRIEF ===\n" +
      "Role: Principal Architect & Invariant Enforcer\n" +
      "Target: Phase 2 Contract Hardening (UTF-8: \u2705 \u26A1 \u{1F512})\n" +
      "Constraint 1: Never mutate state without signed envelope.\n" +
      "Special syntax: <>&\"'\\/ | $VAR %PATH% ~user *star*\n" +
      "Exact whitespace:\r\n  Tabbed indent: \t\t[SEC-01]\n  Trailing space test:     \n" +
      "End of Brief.";

    const briefEnv = makeEnvelope(
      room,
      1,
      BRIEF_SET_SCHEMA,
      {
        member_id: "agent-special",
        text: multilineBrief,
        updated_at: "2026-09-07T12:00:00.000Z",
      },
      "agent-special",
    );
    appendToVirtualLog(vfs, room, briefEnv);

    const report = scanMineRecovery("agent-special", ports);
    const rendered = formatMineRecovery(report);
    const renderedBytes = Buffer.from(rendered, "utf8");
    const briefBytes = Buffer.from(multilineBrief, "utf8");

    const sliceOffset = renderedBytes.indexOf(briefBytes);
    expect(sliceOffset).toBeGreaterThanOrEqual(0);
    const exactSlice = renderedBytes.subarray(sliceOffset, sliceOffset + briefBytes.length);
    expect(timingSafeEqualBuffers(exactSlice, briefBytes)).toBe(true);
  });

  it("Property 3 VACUITY PROOF: Mutating 1 byte of brief text causes assertion to fail red", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const room = "brief-vacuity-room";
    seedRoom(vfs, room);
    seedExistingMember(vfs, room, "agent-special");

    const multilineBrief =
      "=== BRIEF ===\nUTF-8: \u2705 \u26A1 \u{1F512}\nSpecial: <>&\"'\\/\nEnd.";
    const briefEnv = makeEnvelope(
      room,
      1,
      BRIEF_SET_SCHEMA,
      {
        member_id: "agent-special",
        text: multilineBrief,
        updated_at: "2026-09-07T12:00:00.000Z",
      },
      "agent-special",
    );
    appendToVirtualLog(vfs, room, briefEnv);

    const report = scanMineRecovery("agent-special", ports);
    const rendered = formatMineRecovery(report);
    const renderedBytes = Buffer.from(rendered, "utf8");
    const briefBytes = Buffer.from(multilineBrief, "utf8");
    const sliceOffset = renderedBytes.indexOf(briefBytes);
    const exactSlice = renderedBytes.subarray(sliceOffset, sliceOffset + briefBytes.length);

    const corruptedMid = Buffer.from(briefBytes);
    corruptedMid[Math.floor(corruptedMid.length / 2)]! ^= 0x01;
    expect(timingSafeEqualBuffers(exactSlice, corruptedMid)).toBe(false);

    const corruptedStart = Buffer.from(briefBytes);
    corruptedStart[0]! ^= 0x01;
    expect(timingSafeEqualBuffers(exactSlice, corruptedStart)).toBe(false);

    const corruptedEnd = Buffer.from(briefBytes);
    corruptedEnd[corruptedEnd.length - 1]! ^= 0x01;
    expect(timingSafeEqualBuffers(exactSlice, corruptedEnd)).toBe(false);
  });

  it("Property 4: Single-log projection invariant", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const room = "gamma-projection-room";
    seedRoom(vfs, room);
    seedExistingMember(vfs, room, "projection-agent");

    const w1 = makeEnvelope(room, 1, TASK_NEW_SCHEMA, {
      id: "T-101",
      title: "Design state machine",
      status: "open",
      assignee: "projection-agent",
    });
    const b1 = makeEnvelope(
      room,
      2,
      BRIEF_SET_SCHEMA,
      {
        member_id: "projection-agent",
        text: "Persistent state brief for projection",
        updated_at: "2026-09-07T10:02:00.000Z",
      },
      "projection-agent",
    );
    const w2 = makeEnvelope(room, 3, TASK_NEW_SCHEMA, {
      id: "T-102",
      title: "Validate schema invariant",
      status: "open",
      assignee: "projection-agent",
    });

    appendToVirtualLog(vfs, room, w1);
    appendToVirtualLog(vfs, room, b1);
    appendToVirtualLog(vfs, room, w2);

    const initialEnvelopes = readVirtualLogEnvelopes(vfs, room);
    const initialBrief = extractMemberBrief(initialEnvelopes, "projection-agent");
    expect(initialBrief).not.toBeNull();

    const initialReport = scanMineRecovery("projection-agent", ports);
    const initialView = formatMineRecovery(initialReport);

    clearWorkItemsCache(room, ports);
    const cachePath = getWorkCachePath(room);
    if (vfs.existsSync(cachePath)) vfs.unlinkSync(cachePath);

    const replayedEnvelopes = readVirtualLogEnvelopes(vfs, room);
    const replayedBrief = extractMemberBrief(replayedEnvelopes, "projection-agent");
    const replayedReport = scanMineRecovery("projection-agent", ports);
    const replayedView = formatMineRecovery(replayedReport);

    expect(replayedBrief).toEqual(initialBrief);
    expect(replayedReport).toEqual(initialReport);
    expect(replayedView).toBe(initialView);
    expect(
      timingSafeEqualBuffers(Buffer.from(replayedView, "utf8"), Buffer.from(initialView, "utf8")),
    ).toBe(true);
  });

  it("Property 4 VACUITY PROOF: Dropping BRIEF_SET_SCHEMA envelope causes brief to resolve to null", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const room = "gamma-projection-room";
    seedRoom(vfs, room);
    seedExistingMember(vfs, room, "projection-agent");

    const w1 = makeEnvelope(room, 1, TASK_NEW_SCHEMA, {
      id: "T-101",
      title: "Design state machine",
      status: "open",
      assignee: "projection-agent",
    });
    const b1 = makeEnvelope(
      room,
      2,
      BRIEF_SET_SCHEMA,
      {
        member_id: "projection-agent",
        text: "Persistent state brief for projection",
        updated_at: "2026-09-07T10:02:00.000Z",
      },
      "projection-agent",
    );
    appendToVirtualLog(vfs, room, w1);
    appendToVirtualLog(vfs, room, b1);

    const initialEnvelopes = readVirtualLogEnvelopes(vfs, room);
    const initialReport = scanMineRecovery("projection-agent", ports);
    const initialView = formatMineRecovery(initialReport);

    const strippedEnvelopes = initialEnvelopes.filter((e) => e.body?.schema !== BRIEF_SET_SCHEMA);
    const strippedBrief = extractMemberBrief(strippedEnvelopes, "projection-agent");
    expect(strippedBrief).toBeNull();

    const segPath = roomLogSegmentPath(room, "000001.jsonl");
    vfs.writeFileSync(segPath, strippedEnvelopes.map((e) => JSON.stringify(e)).join("\n") + "\n");

    clearWorkItemsCache(room, ports);
    const reportWithoutBrief = scanMineRecovery("projection-agent", ports);
    expect(reportWithoutBrief.brief).toBeNull();

    const viewWithoutBrief = formatMineRecovery(reportWithoutBrief);
    expect(viewWithoutBrief).not.toBe(initialView);
    expect(
      timingSafeEqualBuffers(
        Buffer.from(viewWithoutBrief, "utf8"),
        Buffer.from(initialView, "utf8"),
      ),
    ).toBe(false);
  });
});
