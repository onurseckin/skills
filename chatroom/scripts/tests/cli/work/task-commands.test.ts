import { afterAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { taskCommand, topicCommand } from "../../../src/cli/commands/index.ts";
import { taskSpec, topicSpec } from "../../../src/cli/registry/index.ts";
import { ChatVirtualFS } from "../../../src/testing/virtual-fs/index.ts";
import * as logModule from "../../../src/log/index.ts";
import * as roomModule from "../../../src/room/index.ts";
import * as daemonModule from "../../../src/daemon/index.ts";
import type { AppendMessageInput } from "../../../src/log/index.ts";
import type { Envelope, MemberRecord } from "../../../src/core/index.ts";

const mockFs = await import("node:fs");

describe("task and topic command suite", () => {
  const vfs = new ChatVirtualFS();
  const vfsPrefix = "/virtual-task-test";
  const prevChatHome = process.env.CHATROOM_HOME;
  const prevChatAs = process.env.CHATROOM_AS;
  process.env.CHATROOM_HOME = `${vfsPrefix}/chatroom`;
  process.env.CHATROOM_AS = "tester";

  let capturedAppendInput: AppendMessageInput | undefined;
  let nextSeq = 1;

  const origExists = mockFs.existsSync;
  const origRead = mockFs.readFileSync;
  const origReaddir = mockFs.readdirSync;
  const origStat = mockFs.statSync;

  const existsSpy = spyOn(mockFs, "existsSync").mockImplementation((target: unknown): boolean => {
    const p = String(target);
    return p.startsWith(vfsPrefix)
      ? vfs.existsSync(p)
      : origExists(target as Parameters<typeof origExists>[0]);
  });

  const readSpy = spyOn(mockFs, "readFileSync").mockImplementation(
    (target: unknown, options?: unknown): string | Buffer => {
      const p = String(target);
      return p.startsWith(vfsPrefix)
        ? vfs.readFileSync(p, "utf8")
        : origRead(
            target as Parameters<typeof origRead>[0],
            options as Parameters<typeof origRead>[1],
          );
    },
  );

  const readdirSpy = spyOn(mockFs, "readdirSync").mockImplementation(
    (target: unknown, options?: unknown): string[] => {
      const p = String(target);
      return p.startsWith(vfsPrefix)
        ? vfs.readdirSync(p).map((item) => (typeof item === "string" ? item : item.name))
        : (origReaddir(
            target as Parameters<typeof origReaddir>[0],
            options as Parameters<typeof origReaddir>[1],
          ) as string[]);
    },
  );

  const statSpy = spyOn(mockFs, "statSync").mockImplementation((target: unknown) => {
    const p = String(target);
    return p.startsWith(vfsPrefix)
      ? vfs.statSync(p)
      : origStat(target as Parameters<typeof origStat>[0]);
  });

  const assertMemberSpy = spyOn(roomModule, "assertMember").mockImplementation(
    (_room, identity): MemberRecord => ({
      v: 1,
      id: typeof identity === "string" ? identity : identity.id,
      display_name: "Test Agent",
      role: "communicator",
      host: "local",
      joined_at: new Date().toISOString(),
      key_fingerprint: "sha256:test",
      aliases: [],
    }),
  );

  const resolveMentionSpy = spyOn(roomModule, "resolveMention").mockImplementation(
    (_room, mention): MemberRecord => ({
      v: 1,
      id: mention.startsWith("@") ? mention.slice(1) : mention,
      display_name: mention,
      role: "worker",
      host: "local",
      joined_at: new Date().toISOString(),
      key_fingerprint: "sha256:test",
      aliases: [],
    }),
  );

  const ensureDaemonSpy = spyOn(daemonModule, "ensureDaemon").mockImplementation(() => ({
    status: "running",
    healthy: true,
    probedMs: 0,
  }));

  const appendMessageSpy = spyOn(logModule, "appendMessage").mockImplementation(
    (roomId: string, msg: AppendMessageInput): Envelope => {
      capturedAppendInput = msg;
      const seq = nextSeq++;
      const envelope: Envelope = {
        v: 1,
        id: `msg-${seq}`,
        room: roomId,
        seq,
        ts: msg.ts ?? new Date().toISOString(),
        sender: msg.sender,
        kind: msg.kind,
        ...(msg.thread !== undefined ? { thread: msg.thread } : {}),
        reply_to: msg.reply_to ?? null,
        mentions: msg.mentions ?? [],
        ...(msg.text !== undefined ? { text: msg.text } : {}),
        body: msg.body,
        key_fingerprint: "sha256:keyfp",
        sig: "sig-valid",
      };
      const logDir = `${vfsPrefix}/chatroom/rooms/${roomId}/log`;
      vfs.mkdirSync(logDir, { recursive: true });
      vfs.appendFileSync(`${logDir}/000001.jsonl`, JSON.stringify(envelope) + "\n");
      vfs.writeFileSync(
        `${logDir}/index.json`,
        JSON.stringify({
          next_seq: nextSeq,
          segments: ["000001.jsonl"],
          head_seq: seq,
          updated_at: envelope.ts,
        }),
      );
      return envelope;
    },
  );

  function setupRoom(roomId: string): void {
    const roomDirectory = `${vfsPrefix}/chatroom/rooms/${roomId}`;
    vfs.mkdirSync(`${roomDirectory}/log`, { recursive: true });
    vfs.writeFileSync(
      `${roomDirectory}/room.json`,
      JSON.stringify({ v: 1, id: roomId, title: "Test Room" }),
    );
  }

  beforeEach(() => {
    vfs.reset();
    nextSeq = 1;
    capturedAppendInput = undefined;
    setupRoom("dev-room");
  });

  afterAll(() => {
    existsSpy.mockRestore();
    readSpy.mockRestore();
    readdirSpy.mockRestore();
    statSpy.mockRestore();
    assertMemberSpy.mockRestore();
    resolveMentionSpy.mockRestore();
    ensureDaemonSpy.mockRestore();
    appendMessageSpy.mockRestore();
    if (prevChatHome === undefined) {
      delete process.env.CHATROOM_HOME;
    } else {
      process.env.CHATROOM_HOME = prevChatHome;
    }
    if (prevChatAs === undefined) {
      delete process.env.CHATROOM_AS;
    } else {
      process.env.CHATROOM_AS = prevChatAs;
    }
  });

  it("verifies command specifications have 0 sequence numbers in flags or args", () => {
    expect(taskSpec.name).toBe("chat:task");
    expect(taskSpec.aliases).toContain("task");
    expect(taskSpec.takesRemainder).toBe(true);

    const taskFlags = taskSpec.flags.map((f) => f.name);
    expect(taskFlags).toEqual(["room", "new", "type", "to", "parent", "note", "as", "json"]);
    expect(taskFlags.some((f) => f.includes("seq") || f === "since" || f === "from")).toBe(false);

    expect(topicSpec.name).toBe("chat:topic");
    expect(topicSpec.aliases).toContain("topic");
    expect(topicSpec.takesRemainder).toBe(true);
    const topicFlags = topicSpec.flags.map((f) => f.name);
    expect(topicFlags).toEqual(["room", "json", "as"]);
    expect(topicFlags.some((f) => f.includes("seq"))).toBe(false);
  });

  it("chat task --new creates work item with default type and emits chatroom.task.new.v1", async () => {
    const result = await taskCommand(
      { room: "dev-room", new: "Fix login redirect", json: true },
      {},
      [],
    );
    expect(result["room"]).toBe("dev-room");
    expect(typeof result["id"]).toBe("string");
    const item = { id: String(result["id"]) };
    expect(item.id).toMatch(/^T-[0-9a-f]{4}$/);
    expect(result["seq"]).toBe(1);

    expect(capturedAppendInput).toBeDefined();
    expect(capturedAppendInput?.body.schema).toBe("chatroom.task.new.v1");
    expect(capturedAppendInput?.body.data["title"]).toBe("Fix login redirect");
    expect(capturedAppendInput?.body.data["type"]).toBe("task");
    expect(capturedAppendInput?.body.data["status"]).toBe("open");
    expect(capturedAppendInput?.thread).toBe(item.id);
  });

  it("chat task --new supports custom type, assignee, parent, and explicit task id", async () => {
    const result = await taskCommand(
      {
        room: "dev-room",
        new: "Investigate crash",
        type: "bug",
        to: "alice",
        parent: "EPIC-42",
        json: true,
      },
      {},
      ["BUG-101"],
    );
    expect(result["id"]).toBe("BUG-101");
    expect(result["task_id"]).toBe("BUG-101");
    expect(capturedAppendInput?.body.schema).toBe("chatroom.task.new.v1");
    expect(capturedAppendInput?.body.data["type"]).toBe("bug");
    expect(capturedAppendInput?.body.data["to"]).toBe("alice");
    expect(capturedAppendInput?.body.data["parent"]).toBe("EPIC-42");
    expect(capturedAppendInput?.mentions).toContain("alice");
    expect(capturedAppendInput?.thread).toBe("BUG-101");
  });

  it("chat task <id> <status> transitions status and emits chatroom.task.status.v1", async () => {
    const result = await taskCommand({ room: "dev-room", json: true }, {}, [
      "TASK-200",
      "in_progress",
    ]);
    expect(result["room"]).toBe("dev-room");
    expect(result["id"]).toBe("TASK-200");
    expect(capturedAppendInput?.body.schema).toBe("chatroom.task.status.v1");
    expect(capturedAppendInput?.body.data["status"]).toBe("in_progress");
    expect(capturedAppendInput?.body.data["task_id"]).toBe("TASK-200");
    expect(capturedAppendInput?.thread).toBe("TASK-200");
  });

  it("chat task <id> <status> rejects sequence numbers passed as status", async () => {
    let errorCode = "";
    try {
      await taskCommand({ room: "dev-room" }, {}, ["TASK-200", "812"]);
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        errorCode = String((err as { code: unknown }).code);
      }
    }
    expect(errorCode).toBe("INVALID_ARGUMENT");
  });

  it("chat task <id> --note adds comment on task thread and emits chatroom.task.note.v1", async () => {
    const result = await taskCommand(
      { room: "dev-room", note: "Root cause identified in parser", json: true },
      {},
      ["TASK-300"],
    );
    expect(result["id"]).toBe("TASK-300");
    expect(capturedAppendInput?.body.schema).toBe("chatroom.task.note.v1");
    expect(capturedAppendInput?.body.data["note"]).toBe("Root cause identified in parser");
    expect(capturedAppendInput?.body.data["task_id"]).toBe("TASK-300");
    expect(capturedAppendInput?.thread).toBe("TASK-300");
  });

  it("chat task <id> --note can fallback to --parent when positional id omitted", async () => {
    const result = await taskCommand(
      { room: "dev-room", note: "Note on parent", parent: "TASK-400", json: true },
      {},
      [],
    );
    expect(result["id"]).toBe("TASK-400");
    expect(capturedAppendInput?.body.schema).toBe("chatroom.task.note.v1");
    expect(capturedAppendInput?.thread).toBe("TASK-400");
  });

  it("chat topic <id> prints the whole thread in chronological order", async () => {
    await taskCommand({ room: "dev-room", new: "Feature login", type: "story", json: true }, {}, [
      "STORY-1",
    ]);
    await taskCommand({ room: "dev-room", note: "Working on schema", json: true }, {}, ["STORY-1"]);
    await taskCommand({ room: "dev-room", json: true }, {}, ["STORY-1", "in_progress"]);
    await taskCommand({ room: "dev-room", note: "Ready for review", json: true }, {}, ["STORY-1"]);
    await taskCommand({ room: "dev-room", json: true }, {}, ["STORY-1", "done"]);

    let stdoutCaptured = "";
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      stdoutCaptured += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    };

    let result: Record<string, unknown> = {};
    try {
      result = await topicCommand({ room: "dev-room" }, {}, ["STORY-1"]);
    } finally {
      process.stdout.write = origWrite;
    }

    expect(result["room"]).toBe("dev-room");
    expect(result["topic"]).toBe("STORY-1");
    expect(result["count"]).toBe(5);

    const envelopes = result["envelopes"] as readonly Envelope[];
    expect(envelopes.length).toBe(5);
    expect(envelopes.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);

    expect(stdoutCaptured.includes("[1]")).toBe(true);
    expect(stdoutCaptured.includes("[5]")).toBe(true);
    expect(stdoutCaptured.includes("Feature login")).toBe(true);
    expect(stdoutCaptured.includes("Working on schema")).toBe(true);
    expect(stdoutCaptured.includes("status changed to in_progress")).toBe(true);
    expect(stdoutCaptured.includes("Ready for review")).toBe(true);
    expect(stdoutCaptured.includes("status changed to done")).toBe(true);
  });

  it("chat topic <id> with --json returns structured messages without writing to stdout", async () => {
    await taskCommand({ room: "dev-room", new: "Standalone issue", json: true }, {}, ["ISSUE-50"]);
    let stdoutCaptured = "";
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      stdoutCaptured += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    };

    let result: Record<string, unknown> = {};
    try {
      result = await topicCommand({ room: "dev-room", json: true }, {}, ["ISSUE-50"]);
    } finally {
      process.stdout.write = origWrite;
    }

    expect(stdoutCaptured).toBe("");
    expect(result["count"]).toBe(1);
    const messages = result["messages"] as readonly Envelope[];
    expect(messages[0]?.thread).toBe("ISSUE-50");
  });

  it("rejects invalid task types with INVALID_ARGUMENT", async () => {
    let errorCode = "";
    try {
      await taskCommand({ room: "dev-room", new: "Test", type: "invalid-type" }, {}, []);
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        errorCode = String((err as { code: unknown }).code);
      }
    }
    expect(errorCode).toBe("INVALID_ARGUMENT");
  });

  it("rejects missing topic id with INVALID_ARGUMENT", async () => {
    let errorCode = "";
    try {
      await topicCommand({ room: "dev-room" }, {}, []);
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        errorCode = String((err as { code: unknown }).code);
      }
    }
    expect(errorCode).toBe("INVALID_ARGUMENT");
  });

  it("rejects non-existent room for topic with UNKNOWN_ROOM", async () => {
    let errorCode = "";
    try {
      await topicCommand({ room: "non-existent-room" }, {}, ["TOPIC-1"]);
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        errorCode = String((err as { code: unknown }).code);
      }
    }
    expect(errorCode).toBe("UNKNOWN_ROOM");
  });
});
