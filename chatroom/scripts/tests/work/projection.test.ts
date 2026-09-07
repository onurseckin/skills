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
import { type HealthPorts } from "../../src/daemon/index.ts";
import { ChatVirtualFS } from "../../src/testing/virtual-fs/index.ts";
import {
  clearWorkItemsCache,
  foldWorkItems,
  generateTaskId,
  getWorkCachePath,
  loadWorkItems,
  replayWorkItems,
  TASK_ACCEPTED_SCHEMA,
  TASK_NEW_SCHEMA,
  TASK_NOTE_SCHEMA,
  TASK_STATUS_SCHEMA,
} from "../../src/work/index.ts";

function createHealthPorts(vfs: ChatVirtualFS): HealthPorts {
  return {
    existsSync: (target: string) => vfs.existsSync(target),
    readFileSync: (target: string, encoding: string) =>
      vfs.readFileSync(target, encoding) as string,
    writeFileSync: (target: string, content: string) => {
      vfs.mkdirSync(dirname(target), { recursive: true });
      vfs.writeFileSync(target, content);
    },
    writeAtomic: (target: string, content: string) => {
      vfs.mkdirSync(dirname(target), { recursive: true });
      vfs.writeFileSync(target, content);
    },
  };
}

function makeEnvelope(
  room: string,
  seq: number,
  schema: string,
  data: Readonly<Record<string, unknown>>,
  options?: {
    readonly id?: string;
    readonly text?: string;
    readonly thread?: string;
    readonly reply_to?: string | null;
    readonly mentions?: readonly string[];
    readonly senderId?: string;
    readonly ts?: string;
  },
): Envelope {
  const ts = options?.ts ?? `2026-09-07T10:00:0${seq}.000Z`;
  const unsigned: UnsignedEnvelope = {
    v: 1,
    id: options?.id ?? `msg-${seq}-${room}`,
    room,
    seq,
    ts,
    sender: {
      id: options?.senderId ?? "agent-1",
      role: "implementer",
      host: "antigravity",
    },
    kind: "message",
    thread: options?.thread,
    reply_to: options?.reply_to ?? null,
    mentions: options?.mentions ?? [],
    text: options?.text,
    body: {
      schema,
      data,
    },
    key_fingerprint: "sha256:12345678",
  };
  return signEnvelope(unsigned, "secret-room-key");
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

describe("work item envelopes and projection", () => {
  it("generates deterministic task IDs formatted as T-<hex4>", () => {
    const id1 = generateTaskId(1, "2026-09-07T10:00:00.000Z");
    const id2 = generateTaskId(1, "2026-09-07T10:00:00.000Z");
    const id3 = generateTaskId(2, "2026-09-07T10:00:00.000Z");

    expect(id1).toMatch(/^T-[0-9a-f]{4}$/);
    expect(id1).toBe(id2);
    expect(id1).not.toBe(id3);
  });

  it("folds new, status, note, accepted, and topic mentions correctly", () => {
    const room = "dev-room";
    const e1 = makeEnvelope(room, 1, TASK_NEW_SCHEMA, {
      id: "T-1000",
      title: "Implement core loop",
      type: "story",
      status: "open",
      assignee: "alice",
      parent: "P-100",
    });
    const e2 = makeEnvelope(room, 2, TASK_STATUS_SCHEMA, {
      id: "T-1000",
      status: "in_progress",
    });
    const e3 = makeEnvelope(room, 3, TASK_NOTE_SCHEMA, {
      id: "T-1000",
      text: "Starting work on event fold",
      author: "alice",
    });
    const e4 = makeEnvelope(
      room,
      4,
      "chatroom.text.v1",
      {
        text: "Regarding T-1000, looks good so far",
      },
      {
        mentions: ["T-1000"],
        text: "Regarding T-1000, looks good so far",
      },
    );
    const e5 = makeEnvelope(
      room,
      5,
      "chatroom.text.v1",
      {
        text: "Replying to note",
      },
      {
        reply_to: e3.id,
        text: "Replying to note",
      },
    );
    const e6 = makeEnvelope(room, 6, TASK_ACCEPTED_SCHEMA, {
      id: "T-1000",
      accepted_at: "2026-09-07T10:05:00.000Z",
    });
    const e7 = makeEnvelope(room, 7, TASK_STATUS_SCHEMA, {
      id: "T-1000",
      status: "done",
    });

    const items = foldWorkItems([e7, e2, e1, e4, e3, e6, e5], room);
    expect(items.size).toBe(1);

    const item = items.get("T-1000");
    expect(item).toBeDefined();
    expect(item?.id).toBe("T-1000");
    expect(item?.room).toBe(room);
    expect(item?.title).toBe("Implement core loop");
    expect(item?.type).toBe("story");
    expect(item?.status).toBe("done");
    expect(item?.assignee).toBe("alice");
    expect(item?.parent).toBe("P-100");
    expect(item?.initial_seq).toBe(1);
    expect(item?.accepted_at).toBe("2026-09-07T10:05:00.000Z");
    expect(item?.updated_at).toBe(e7.ts);
    expect(item?.notes.length).toBe(1);
    expect(item?.notes[0]?.text).toBe("Starting work on event fold");
    expect(item?.notes[0]?.author).toBe("alice");
    expect(item?.notes[0]?.seq).toBe(3);
    expect(item?.topic_seqs).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("ignores envelopes for different rooms", () => {
    const roomA = "room-a";
    const roomB = "room-b";
    const eA = makeEnvelope(roomA, 1, TASK_NEW_SCHEMA, {
      id: "T-0001",
      title: "Task in room A",
    });
    const eB = makeEnvelope(roomB, 2, TASK_NEW_SCHEMA, {
      id: "T-0002",
      title: "Task in room B",
    });

    const itemsA = foldWorkItems([eA, eB], roomA);
    expect(itemsA.size).toBe(1);
    expect(itemsA.has("T-0001")).toBe(true);
    expect(itemsA.has("T-0002")).toBe(false);
  });

  it("handles default values on item creation when optional fields are omitted", () => {
    const room = "default-room";
    const e1 = makeEnvelope(
      room,
      1,
      TASK_NEW_SCHEMA,
      {},
      {
        text: "Fallback title",
        ts: "2026-09-07T11:00:00.000Z",
      },
    );
    const items = foldWorkItems([e1], room);
    const item = Array.from(items.values())[0];

    expect(item).toBeDefined();
    expect(item?.id).toMatch(/^T-[0-9a-f]{4}$/);
    expect(item?.title).toBe("Fallback title");
    expect(item?.type).toBe("task");
    expect(item?.status).toBe("open");
    expect(item?.assignee).toBeNull();
    expect(item?.parent).toBeNull();
    expect(item?.accepted_at).toBeNull();
    expect(item?.notes).toEqual([]);
    expect(item?.topic_seqs).toEqual([1]);
  });

  it("enforces replay equality after wiping all cached state in ChatVirtualFS", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const room = "replay-room";

    clearWorkItemsCache();

    const e1 = makeEnvelope(room, 1, TASK_NEW_SCHEMA, {
      id: "T-0001",
      title: "Create persistent store",
      type: "story",
      status: "open",
      assignee: "alice",
      parent: "P-10",
    });
    const e2 = makeEnvelope(room, 2, TASK_NEW_SCHEMA, {
      id: "T-0002",
      title: "Fix lock race",
      type: "bug",
      status: "open",
      assignee: "bob",
    });
    const e3 = makeEnvelope(
      room,
      3,
      TASK_NEW_SCHEMA,
      {
        title: "Unassigned question",
        type: "question",
      },
      {
        text: "Unassigned question",
      },
    );
    const generatedId = generateTaskId(3, e3.ts);

    const e4 = makeEnvelope(room, 4, TASK_STATUS_SCHEMA, {
      id: "T-0001",
      status: "in_progress",
    });
    const e5 = makeEnvelope(room, 5, TASK_NOTE_SCHEMA, {
      id: "T-0001",
      text: "First progress note on T-0001",
      author: "alice",
    });
    const e6 = makeEnvelope(room, 6, TASK_NOTE_SCHEMA, {
      id: "T-0002",
      text: "Investigating defect logs",
      author: "bob",
    });
    const e7 = makeEnvelope(room, 7, TASK_STATUS_SCHEMA, {
      id: "T-0002",
      status: "blocked",
    });
    const e8 = makeEnvelope(
      room,
      8,
      "chatroom.text.v1",
      {
        text: `Clarifying question ${generatedId}`,
      },
      {
        thread: generatedId,
        text: `Clarifying question ${generatedId}`,
      },
    );
    const e9 = makeEnvelope(
      room,
      9,
      "chatroom.text.v1",
      {
        text: "Replying to investigation note",
      },
      {
        reply_to: e6.id,
        text: "Replying to investigation note",
      },
    );
    const e10 = makeEnvelope(room, 10, TASK_NOTE_SCHEMA, {
      id: "T-0001",
      text: "Second note before review",
      author: "alice",
    });
    const e11 = makeEnvelope(room, 11, TASK_STATUS_SCHEMA, {
      id: "T-0001",
      status: "review",
    });
    const e12 = makeEnvelope(room, 12, TASK_ACCEPTED_SCHEMA, {
      id: "T-0001",
      accepted_at: "2026-09-07T12:30:00.000Z",
    });
    const e13 = makeEnvelope(room, 13, TASK_STATUS_SCHEMA, {
      id: "T-0001",
      status: "done",
    });
    const e14 = makeEnvelope(room, 14, TASK_STATUS_SCHEMA, {
      id: "T-0002",
      status: "in_progress",
    });

    const envelopes = [e1, e2, e3, e4, e5, e6, e7, e8, e9, e10, e11, e12, e13, e14];
    for (const env of envelopes) {
      appendToVirtualLog(vfs, room, env);
    }

    const loaded = loadWorkItems(room, ports);
    expect(loaded.size).toBe(3);

    const cachePath = getWorkCachePath(room);
    expect(vfs.existsSync(cachePath)).toBe(true);

    clearWorkItemsCache(room, ports);
    expect(vfs.readFileSync(cachePath, "utf8")).toBe("");
    if (vfs.existsSync(cachePath)) {
      vfs.unlinkSync(cachePath);
    }
    expect(vfs.existsSync(cachePath)).toBe(false);

    const replayed = replayWorkItems(room, ports);
    expect(replayed.size).toBe(3);

    expect(replayed).toEqual(loaded);

    const loadedEntries = Array.from(loaded.entries());
    const replayedEntries = Array.from(replayed.entries());

    const loadedSerialized = canonicalJson(loadedEntries);
    const replayedSerialized = canonicalJson(replayedEntries);
    expect(replayedSerialized).toBe(loadedSerialized);

    const loadedBytes = canonicalJsonBytes(loadedEntries);
    const replayedBytes = canonicalJsonBytes(replayedEntries);
    expect(timingSafeEqualBuffers(loadedBytes, replayedBytes)).toBe(true);

    const reloaded = loadWorkItems(room, ports);
    expect(reloaded).toEqual(replayed);
  });
});
