import { afterAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { dirname, join } from "node:path";
const mockFs = await import("node:fs");
import * as coreModule from "../../../src/core/index.ts";
import * as daemonModule from "../../../src/daemon/index.ts";
import * as logModule from "../../../src/log/index.ts";
import { briefCommand, joinCommand } from "../../../src/cli/commands/index.ts";
import { briefSpec, findCommand, joinSpec } from "../../../src/cli/registry/index.ts";
import { ChatVirtualFS } from "../../../src/testing/virtual-fs/index.ts";
import { BRIEF_SET_SCHEMA } from "../../../src/work/index.ts";
import type { AppendMessageInput } from "../../../src/log/index.ts";
import type { Envelope } from "../../../src/core/index.ts";

describe("brief and join enforcement suite", () => {
  const vfs = new ChatVirtualFS();
  const vfsPrefix = "/virtual-brief-suite";
  const prevChatHome = process.env.CHATROOM_HOME;
  const prevChatAs = process.env.CHATROOM_AS;
  process.env.CHATROOM_HOME = vfsPrefix;
  process.env.CHATROOM_AS = "tester";

  let capturedAppendInputs: AppendMessageInput[] = [];
  let nextSeq = 1;

  const origExists = mockFs.existsSync;
  const origRead = mockFs.readFileSync;
  const origReaddir = mockFs.readdirSync;
  const origStat = mockFs.statSync;
  const origMkdir = mockFs.mkdirSync;
  const origWriteFile = mockFs.writeFileSync;

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

  const mkdirSpy = spyOn(mockFs, "mkdirSync").mockImplementation(
    (target: unknown, options?: unknown): unknown => {
      const p = String(target);
      if (p.startsWith(vfsPrefix)) {
        vfs.mkdirSync(p, { recursive: true });
        return undefined;
      }
      return origMkdir(
        target as Parameters<typeof origMkdir>[0],
        options as Parameters<typeof origMkdir>[1],
      );
    },
  );

  const writeFileSpy = spyOn(mockFs, "writeFileSync").mockImplementation(
    (target: unknown, data: unknown, options?: unknown): void => {
      const p = String(target);
      if (p.startsWith(vfsPrefix)) {
        vfs.mkdirSync(dirname(p), { recursive: true });
        vfs.writeFileSync(
          p,
          typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8"),
        );
        return;
      }
      origWriteFile(
        target as Parameters<typeof origWriteFile>[0],
        data as Parameters<typeof origWriteFile>[1],
        options as Parameters<typeof origWriteFile>[2],
      );
    },
  );

  const writeAtomicSpy = spyOn(coreModule, "writeAtomic").mockImplementation(
    (target: string, content: string | Uint8Array) => {
      const p = String(target);
      vfs.mkdirSync(dirname(p), { recursive: true });
      vfs.writeFileSync(
        p,
        typeof content === "string" ? content : Buffer.from(content).toString("utf8"),
      );
    },
  );

  const ensureDaemonSpy = spyOn(daemonModule, "ensureDaemon").mockImplementation(() => ({
    status: "running",
    healthy: true,
    probedMs: 0,
  }));

  const appendMessageSpy = spyOn(logModule, "appendMessage").mockImplementation(
    (roomId: string, msg: AppendMessageInput): Envelope => {
      capturedAppendInputs.push(msg);
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
      const logDir = `${vfsPrefix}/rooms/${roomId}/log`;
      vfs.mkdirSync(logDir, { recursive: true });
      const existing = vfs.existsSync(`${logDir}/000001.jsonl`)
        ? (vfs.readFileSync(`${logDir}/000001.jsonl`, "utf8") as string)
        : "";
      vfs.writeFileSync(`${logDir}/000001.jsonl`, `${existing}${JSON.stringify(envelope)}\n`);
      vfs.writeFileSync(
        `${vfsPrefix}/rooms/${roomId}/log.index.json`,
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

  function setupPublicRoom(roomId: string): void {
    const roomDirectory = `${vfsPrefix}/rooms/${roomId}`;
    vfs.mkdirSync(`${roomDirectory}/log`, { recursive: true });
    vfs.mkdirSync(`${roomDirectory}/members`, { recursive: true });
    vfs.writeFileSync(
      `${roomDirectory}/room.json`,
      JSON.stringify({
        v: 1,
        id: roomId,
        title: "Test Room",
        visibility: "public",
        key_fingerprint: "sha256:test",
        created_at: new Date().toISOString(),
        created_by: "system",
        settings: {
          lease_ttl_ms: 30000,
          max_payload_bytes: 65536,
          segment_max_bytes: 1048576,
          segment_max_lines: 1000,
        },
      }),
    );
  }

  function addExistingMember(roomId: string, memberId: string): void {
    const memberPath = `${vfsPrefix}/rooms/${roomId}/members/${memberId}.json`;
    vfs.mkdirSync(dirname(memberPath), { recursive: true });
    vfs.writeFileSync(
      memberPath,
      JSON.stringify({
        v: 1,
        id: memberId,
        display_name: memberId,
        role: "worker",
        host: "local",
        joined_at: new Date().toISOString(),
      }),
    );
  }

  beforeEach(() => {
    vfs.reset();
    nextSeq = 1;
    capturedAppendInputs = [];
    setupPublicRoom("dev-room");
  });

  afterAll(() => {
    existsSpy.mockRestore();
    readSpy.mockRestore();
    readdirSpy.mockRestore();
    statSpy.mockRestore();
    mkdirSpy.mockRestore();
    writeFileSpy.mockRestore();
    writeAtomicSpy.mockRestore();
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

  it("verifies command registry specifications for brief and join", () => {
    expect(briefSpec.name).toBe("chat:brief");
    expect(briefSpec.aliases).toContain("brief");
    const flagNames = briefSpec.flags.map((f) => f.name);
    expect(flagNames).toEqual(["room", "as", "set", "json"]);

    const joinFlagNames = joinSpec.flags.map((f) => f.name);
    expect(joinFlagNames).toContain("brief");

    expect(findCommand("brief")).toBeDefined();
    expect(findCommand("chat:brief")).toBeDefined();
  });

  it("chat brief view returns empty state when no recovery brief exists", async () => {
    let capturedStdout = "";
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      capturedStdout += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    };

    let result: Record<string, unknown> = {};
    try {
      result = await briefCommand({ room: "dev-room", as: "alice" }, {}, []);
    } finally {
      process.stdout.write = origWrite;
    }

    expect(result["exists"]).toBe(false);
    expect(result["text"]).toBeNull();
    expect(result["seq"]).toBeNull();
    expect(result["updated_at"]).toBeNull();
    expect(result["message"]).toBe("No recovery brief set for alice in room dev-room.");
    expect(capturedStdout.includes("No recovery brief set for alice in room dev-room.")).toBe(true);
  });

  it("chat brief --set creates log envelope and updates subsequent brief view", async () => {
    const setResult = await briefCommand(
      { room: "dev-room", as: "alice", set: "Alice working on auth engine", json: true },
      {},
      [],
    );

    expect(setResult["ok"]).toBe(true);
    expect(setResult["room"]).toBe("dev-room");
    expect(setResult["member_id"]).toBe("alice");
    expect(setResult["text"]).toBe("Alice working on auth engine");
    expect(setResult["seq"]).toBe(1);
    expect(typeof setResult["updated_at"]).toBe("string");

    expect(capturedAppendInputs.length).toBe(1);
    const lastInput = capturedAppendInputs[0];
    expect(lastInput?.body.schema).toBe(BRIEF_SET_SCHEMA);
    expect(lastInput?.body.data["member_id"]).toBe("alice");
    expect(lastInput?.body.data["text"]).toBe("Alice working on auth engine");

    const viewResult = await briefCommand({ room: "dev-room", as: "alice", json: true }, {}, []);
    expect(viewResult["exists"]).toBe(true);
    expect(viewResult["text"]).toBe("Alice working on auth engine");
    expect(viewResult["seq"]).toBe(1);
    expect(viewResult["member_id"]).toBe("alice");
  });

  it("chat brief --set isolates multiple members and advances seq on revision", async () => {
    await briefCommand(
      { room: "dev-room", as: "alice", set: "Alice initial brief", json: true },
      {},
      [],
    );
    await briefCommand(
      { room: "dev-room", as: "bob", set: "Bob initial brief", json: true },
      {},
      [],
    );
    await briefCommand(
      { room: "dev-room", as: "alice", set: "Alice revised brief", json: true },
      {},
      [],
    );

    const aliceView = await briefCommand({ room: "dev-room", as: "alice", json: true }, {}, []);
    expect(aliceView["exists"]).toBe(true);
    expect(aliceView["text"]).toBe("Alice revised brief");
    expect(aliceView["seq"]).toBe(3);

    const bobView = await briefCommand({ room: "dev-room", as: "bob", json: true }, {}, []);
    expect(bobView["exists"]).toBe(true);
    expect(bobView["text"]).toBe("Bob initial brief");
    expect(bobView["seq"]).toBe(2);
  });

  it("chat brief --set rejects empty text with INVALID_ARGUMENT", async () => {
    let errorCode = "";
    try {
      await briefCommand({ room: "dev-room", as: "alice", set: "   " }, {}, []);
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        errorCode = String((err as { code: unknown }).code);
      }
    }
    expect(errorCode).toBe("INVALID_ARGUMENT");
  });

  it("chat join fails with INVALID_ARGUMENT when new member joins without --brief", async () => {
    let errorCode = "";
    let errorMessage = "";
    try {
      await joinCommand({ room: "dev-room", as: "newbie", json: true }, {}, []);
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        errorCode = String((err as { code: unknown }).code);
      }
      if (err instanceof Error) {
        errorMessage = err.message;
      }
    }

    expect(errorCode).toBe("INVALID_ARGUMENT");
    expect(errorMessage.includes("recovery brief required for new room members")).toBe(true);
    expect(vfs.existsSync(`${vfsPrefix}/rooms/dev-room/members/newbie.json`)).toBe(false);
  });

  it("chat join succeeds when new member joins with --brief", async () => {
    const briefText = "Newbie agent: implementing worker recovery handler";
    const result = await joinCommand(
      { room: "dev-room", as: "newbie", brief: briefText, json: true },
      {},
      [],
    );

    expect(result["joined"]).toBe(true);
    expect(result["room"]).toBe("dev-room");
    expect(result["as"]).toBe("newbie");
    expect(result["brief"]).toBe(briefText);

    expect(vfs.existsSync(`${vfsPrefix}/rooms/dev-room/members/newbie.json`)).toBe(true);

    const briefMessage = capturedAppendInputs.find(
      (input) => input.body.schema === BRIEF_SET_SCHEMA,
    );
    expect(briefMessage).toBeDefined();
    expect(briefMessage?.body.data["member_id"]).toBe("newbie");
    expect(briefMessage?.body.data["text"]).toBe(briefText);

    const briefCheck = await briefCommand({ room: "dev-room", as: "newbie", json: true }, {}, []);
    expect(briefCheck["exists"]).toBe(true);
    expect(briefCheck["text"]).toBe(briefText);
  });

  it("chat join allows existing members without --brief", async () => {
    addExistingMember("dev-room", "veteran");
    const result = await joinCommand({ room: "dev-room", as: "veteran", json: true }, {}, []);
    expect(result["joined"]).toBe(true);
    expect(result["room"]).toBe("dev-room");
    expect(result["as"]).toBe("veteran");
  });
});
