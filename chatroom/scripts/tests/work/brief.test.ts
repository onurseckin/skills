import { describe, expect, it } from "bun:test";
import { dirname } from "node:path";
import {
  canonicalJson,
  canonicalJsonBytes,
  roomLogIndexPath,
  roomLogSegmentPath,
  timingSafeEqualBuffers,
  type Envelope,
  type LogIndex,
  type UnsignedEnvelope,
} from "../../src/core/index.ts";
import { signEnvelope } from "../../src/crypto/index.ts";
import { ChatVirtualFS } from "../../src/testing/virtual-fs/index.ts";
import {
  BRIEF_SET_SCHEMA,
  extractMemberBrief,
  foldMemberBriefs,
  TASK_NEW_SCHEMA,
} from "../../src/work/index.ts";

function makeBriefEnvelope(
  room: string,
  seq: number,
  memberId: string,
  text: string,
  updatedAt: string,
): Envelope {
  const unsigned: UnsignedEnvelope = {
    v: 1,
    id: `msg-${seq}-${room}`,
    room,
    seq,
    ts: updatedAt,
    sender: {
      id: memberId,
      role: "agent",
      host: "antigravity",
    },
    kind: "message",
    reply_to: null,
    mentions: [],
    body: {
      schema: BRIEF_SET_SCHEMA,
      data: {
        member_id: memberId,
        text,
        updated_at: updatedAt,
      },
    },
    key_fingerprint: "sha256:12345678",
  };
  return signEnvelope(unsigned, "test-secret-key");
}

function makeCustomEnvelope(
  room: string,
  seq: number,
  schema: string,
  data: Readonly<Record<string, unknown>>,
  senderId = "agent-1",
): Envelope {
  const ts = `2026-09-07T10:00:0${seq}.000Z`;
  const unsigned: UnsignedEnvelope = {
    v: 1,
    id: `msg-${seq}-${room}`,
    room,
    seq,
    ts,
    sender: {
      id: senderId,
      role: "agent",
      host: "antigravity",
    },
    kind: "message",
    reply_to: null,
    mentions: [],
    body: {
      schema,
      data,
    },
    key_fingerprint: "sha256:12345678",
  };
  return signEnvelope(unsigned, "test-secret-key");
}

function appendToVirtualLog(vfs: ChatVirtualFS, room: string, envelope: Envelope): void {
  const segPath = roomLogSegmentPath(room, "000001.jsonl");
  vfs.mkdirSync(dirname(segPath), { recursive: true });
  const existing = vfs.existsSync(segPath) ? (vfs.readFileSync(segPath, "utf8") as string) : "";
  const updated = `${existing}${JSON.stringify(envelope)}\n`;
  vfs.writeFileSync(segPath, updated);

  const indexPath = roomLogIndexPath(room);
  const index: LogIndex = {
    next_seq: envelope.seq + 1,
    segments: ["000001.jsonl"],
    head_seq: envelope.seq,
    updated_at: envelope.ts,
  };
  vfs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

function readVirtualLogEnvelopes(vfs: ChatVirtualFS, room: string): readonly Envelope[] {
  const segPath = roomLogSegmentPath(room, "000001.jsonl");
  if (!vfs.existsSync(segPath)) {
    return [];
  }
  const content = vfs.readFileSync(segPath, "utf8") as string;
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Envelope);
}

describe("brief store and folding logic", () => {
  it("folding empty log yields empty map", () => {
    const vfs = new ChatVirtualFS();
    const room = "test-room";
    const envelopes = readVirtualLogEnvelopes(vfs, room);
    const briefs = foldMemberBriefs(envelopes);
    expect(briefs.size).toBe(0);
    expect(extractMemberBrief(envelopes, "agent-1")).toBeNull();
  });

  it("folding single brief envelope records member, text, updated_at, seq", () => {
    const vfs = new ChatVirtualFS();
    const room = "test-room";
    const env = makeBriefEnvelope(
      room,
      1,
      "agent-1",
      "Implementing self-recovery brief",
      "2026-09-07T12:00:00.000Z",
    );
    appendToVirtualLog(vfs, room, env);

    const envelopes = readVirtualLogEnvelopes(vfs, room);
    const briefs = foldMemberBriefs(envelopes);
    expect(briefs.size).toBe(1);

    const record = briefs.get("agent-1");
    expect(record).toBeDefined();
    expect(record?.member_id).toBe("agent-1");
    expect(record?.text).toBe("Implementing self-recovery brief");
    expect(record?.updated_at).toBe("2026-09-07T12:00:00.000Z");
    expect(record?.seq).toBe(1);

    const extracted = extractMemberBrief(envelopes, "agent-1");
    expect(extracted).toEqual(record ?? null);
    expect(extractMemberBrief(envelopes, "unknown-agent")).toBeNull();
  });

  it("updating brief replaces prior text with latest seq", () => {
    const vfs = new ChatVirtualFS();
    const room = "test-room";
    const env1 = makeBriefEnvelope(
      room,
      1,
      "agent-1",
      "Initial brief content",
      "2026-09-07T12:00:00.000Z",
    );
    const env2 = makeBriefEnvelope(
      room,
      4,
      "agent-1",
      "Updated brief content with latest findings",
      "2026-09-07T12:10:00.000Z",
    );
    appendToVirtualLog(vfs, room, env1);
    appendToVirtualLog(vfs, room, env2);

    const envelopes = readVirtualLogEnvelopes(vfs, room);
    const briefs = foldMemberBriefs(envelopes);
    expect(briefs.size).toBe(1);

    const record = briefs.get("agent-1");
    expect(record).toBeDefined();
    expect(record?.member_id).toBe("agent-1");
    expect(record?.text).toBe("Updated brief content with latest findings");
    expect(record?.updated_at).toBe("2026-09-07T12:10:00.000Z");
    expect(record?.seq).toBe(4);

    const reversedFold = foldMemberBriefs([env2, env1]);
    expect(reversedFold.get("agent-1")?.seq).toBe(4);
    expect(reversedFold.get("agent-1")?.text).toBe("Updated brief content with latest findings");
  });

  it("multiple members maintain isolated briefs", () => {
    const vfs = new ChatVirtualFS();
    const room = "test-room";
    const env1 = makeBriefEnvelope(
      room,
      1,
      "agent-1",
      "Agent 1 initial brief",
      "2026-09-07T12:00:00.000Z",
    );
    const env2 = makeBriefEnvelope(
      room,
      2,
      "agent-2",
      "Agent 2 initial brief",
      "2026-09-07T12:05:00.000Z",
    );
    const env3 = makeBriefEnvelope(
      room,
      3,
      "agent-3",
      "Agent 3 initial brief",
      "2026-09-07T12:10:00.000Z",
    );
    const env4 = makeBriefEnvelope(
      room,
      4,
      "agent-1",
      "Agent 1 revised brief",
      "2026-09-07T12:15:00.000Z",
    );

    appendToVirtualLog(vfs, room, env1);
    appendToVirtualLog(vfs, room, env2);
    appendToVirtualLog(vfs, room, env3);
    appendToVirtualLog(vfs, room, env4);

    const envelopes = readVirtualLogEnvelopes(vfs, room);
    const briefs = foldMemberBriefs(envelopes);
    expect(briefs.size).toBe(3);

    const record1 = briefs.get("agent-1");
    expect(record1?.text).toBe("Agent 1 revised brief");
    expect(record1?.seq).toBe(4);

    const record2 = briefs.get("agent-2");
    expect(record2?.text).toBe("Agent 2 initial brief");
    expect(record2?.seq).toBe(2);

    const record3 = briefs.get("agent-3");
    expect(record3?.text).toBe("Agent 3 initial brief");
    expect(record3?.seq).toBe(3);

    expect(extractMemberBrief(envelopes, "agent-1")?.text).toBe("Agent 1 revised brief");
    expect(extractMemberBrief(envelopes, "agent-2")?.text).toBe("Agent 2 initial brief");
    expect(extractMemberBrief(envelopes, "agent-3")?.text).toBe("Agent 3 initial brief");
  });

  it("ignores non-brief schemas", () => {
    const vfs = new ChatVirtualFS();
    const room = "test-room";
    const envTask = makeCustomEnvelope(room, 1, TASK_NEW_SCHEMA, {
      title: "Implement feature",
      type: "task",
    });
    const envText = makeCustomEnvelope(room, 2, "chatroom.text.v1", {
      text: "Hello everyone",
    });
    const envUnknown = makeCustomEnvelope(room, 3, "custom.unknown.v1", {
      foo: "bar",
    });
    const envInvalid1 = makeCustomEnvelope(room, 4, BRIEF_SET_SCHEMA, {
      member_id: 123,
      text: "invalid member id",
      updated_at: "2026-09-07T12:00:00.000Z",
    });
    const envInvalid2 = makeCustomEnvelope(room, 5, BRIEF_SET_SCHEMA, {
      member_id: "agent-bad",
      updated_at: "2026-09-07T12:00:00.000Z",
    });
    const envValid = makeBriefEnvelope(
      room,
      6,
      "agent-1",
      "Only valid brief",
      "2026-09-07T12:20:00.000Z",
    );

    appendToVirtualLog(vfs, room, envTask);
    appendToVirtualLog(vfs, room, envText);
    appendToVirtualLog(vfs, room, envUnknown);
    appendToVirtualLog(vfs, room, envInvalid1);
    appendToVirtualLog(vfs, room, envInvalid2);
    appendToVirtualLog(vfs, room, envValid);

    const envelopes = readVirtualLogEnvelopes(vfs, room);
    const briefs = foldMemberBriefs(envelopes);
    expect(briefs.size).toBe(1);
    expect(briefs.has("agent-1")).toBe(true);
    expect(briefs.get("agent-1")?.text).toBe("Only valid brief");
    expect(briefs.get("agent-1")?.seq).toBe(6);
  });

  it("replay equality: folding replayed log matches initial projection byte-for-byte", () => {
    const vfs = new ChatVirtualFS();
    const room = "replay-room";

    const envs: readonly Envelope[] = [
      makeBriefEnvelope(room, 1, "agent-1", "Alpha phase 1", "2026-09-07T10:00:00.000Z"),
      makeBriefEnvelope(room, 2, "agent-2", "Beta phase 1", "2026-09-07T10:01:00.000Z"),
      makeCustomEnvelope(room, 3, TASK_NEW_SCHEMA, { id: "T-01" }),
      makeBriefEnvelope(room, 4, "agent-1", "Alpha phase 2", "2026-09-07T10:02:00.000Z"),
      makeCustomEnvelope(room, 5, "chatroom.text.v1", { text: "checkpoint" }),
      makeBriefEnvelope(room, 6, "agent-3", "Gamma phase 1", "2026-09-07T10:03:00.000Z"),
      makeBriefEnvelope(room, 7, "agent-2", "Beta phase 2", "2026-09-07T10:04:00.000Z"),
    ];

    for (const env of envs) {
      appendToVirtualLog(vfs, room, env);
    }

    const initialEnvelopes = readVirtualLogEnvelopes(vfs, room);
    const initial = foldMemberBriefs(initialEnvelopes);

    const replayedEnvelopes = readVirtualLogEnvelopes(vfs, room);
    const replayed = foldMemberBriefs(replayedEnvelopes);

    expect(replayed.size).toBe(initial.size);
    expect(replayed).toEqual(initial);

    const initialEntries = Array.from(initial.entries()).sort(([a], [b]) => a.localeCompare(b));
    const replayedEntries = Array.from(replayed.entries()).sort(([a], [b]) => a.localeCompare(b));

    const initialJson = canonicalJson(initialEntries);
    const replayedJson = canonicalJson(replayedEntries);
    expect(replayedJson).toBe(initialJson);

    const initialBytes = canonicalJsonBytes(initialEntries);
    const replayedBytes = canonicalJsonBytes(replayedEntries);
    expect(timingSafeEqualBuffers(initialBytes, replayedBytes)).toBe(true);
  });
});
