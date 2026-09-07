import { afterAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { CHAT_COMMANDS, findCommand, inspectCommand, inspectSpec } from "../../src/cli/index.ts";
import { ChatError, type Envelope } from "../../src/core/index.ts";
import { ChatVirtualFS } from "../../src/testing/virtual-fs/index.ts";
import { main } from "../../../index.ts";

const mockFs = await import("node:fs");
const VFS_PREFIX = "/virtual-inspect-fs";

function makeEnvelope(
  seq: number,
  kind: string,
  schema: string,
  text?: string,
  payloadData?: Record<string, unknown>,
): Envelope {
  return {
    v: 1,
    id: `env-${seq}`,
    room: "alpha-room",
    seq,
    ts: new Date(1700000000000 + seq * 1000).toISOString(),
    sender: { id: "agent-1", role: "communicator", host: "local" },
    kind,
    mentions: [],
    reply_to: null,
    ...(text !== undefined ? { text } : {}),
    body: {
      schema,
      data: payloadData ?? { text },
    },
    key_fingerprint: "fp-test",
    sig: "sig-test",
  };
}

describe("inspectSpec and Derived Guard", () => {
  it("verifies inspectSpec registration in CHAT_COMMANDS and spec schema", () => {
    expect(CHAT_COMMANDS.includes(inspectSpec)).toBe(true);
    expect(inspectSpec.name).toBe("chat:inspect");
    expect(inspectSpec.aliases).toContain("inspect");
    expect(inspectSpec.readsStdin).toBe(false);
    expect(inspectSpec.takesRemainder).toBe(false);
    expect(inspectSpec.handler).toBe(inspectCommand);

    const flagNames = inspectSpec.flags.map((f) => f.name);
    expect(flagNames).toEqual(["room", "since", "type", "limit", "json"]);

    const roomFlag = inspectSpec.flags.find((f) => f.name === "room");
    expect(roomFlag?.required).toBe(true);
    expect(roomFlag?.type).toBe("string");

    const sinceFlag = inspectSpec.flags.find((f) => f.name === "since");
    expect(sinceFlag?.required).toBe(false);
    expect(sinceFlag?.type).toBe("int");

    const typeFlag = inspectSpec.flags.find((f) => f.name === "type");
    expect(typeFlag?.required).toBe(false);
    expect(typeFlag?.type).toBe("string");

    const limitFlag = inspectSpec.flags.find((f) => f.name === "limit");
    expect(limitFlag?.required).toBe(false);
    expect(limitFlag?.type).toBe("int");

    const jsonFlag = inspectSpec.flags.find((f) => f.name === "json");
    expect(jsonFlag?.required).toBe(false);
    expect(jsonFlag?.type).toBe("bool");

    expect(findCommand("chat:inspect")).toBe(inspectSpec);
    expect(findCommand("inspect")).toBe(inspectSpec);
  });

  it("Derived Guard: inspect.ts does not import or reference cursor mutation or lock primitives", async () => {
    const inspectFilePath = new URL("../../src/cli/commands/inspect.ts", import.meta.url);
    const source = await Bun.file(inspectFilePath).text();

    const forbidden = [
      "leaseNext",
      "ackLease",
      "saveCursorCas",
      "saveCursor",
      "withReaderLock",
      "writeReceipt",
      "createInitialCursor",
      "writeCursor",
      "updateCursor",
      "withLock",
      "releaseLock",
      "acquireLock",
    ];

    for (const name of forbidden) {
      const regex = new RegExp(`\\b${name}\\b`);
      expect(regex.test(source)).toBe(false);
    }

    expect(source.includes("/cursor")).toBe(false);
    expect(source.includes("receipt")).toBe(false);
  });
});

describe("inspectCommand log inspection with ChatVirtualFS", () => {
  const vfs = new ChatVirtualFS();
  const previousChatroomHome = process.env.CHATROOM_HOME;

  const originalExists = mockFs.existsSync;
  const originalRead = mockFs.readFileSync;
  const originalReaddir = mockFs.readdirSync;
  const originalStat = mockFs.statSync;

  const existsSpy = spyOn(mockFs, "existsSync").mockImplementation((target: unknown): boolean => {
    const pathStr = String(target);
    if (pathStr.startsWith(VFS_PREFIX)) {
      return vfs.existsSync(pathStr);
    }
    return originalExists(target as Parameters<typeof originalExists>[0]);
  });

  const readSpy = spyOn(mockFs, "readFileSync").mockImplementation(
    (target: unknown, options?: unknown): string | Buffer => {
      const pathStr = String(target);
      if (pathStr.startsWith(VFS_PREFIX)) {
        const result = vfs.readFileSync(pathStr, "utf-8");
        return typeof result === "string" ? result : Buffer.from(result);
      }
      return originalRead(
        target as Parameters<typeof originalRead>[0],
        options as Parameters<typeof originalRead>[1],
      );
    },
  );

  const readdirSpy = spyOn(mockFs, "readdirSync").mockImplementation(
    (target: unknown, options?: unknown): string[] => {
      const pathStr = String(target);
      if (pathStr.startsWith(VFS_PREFIX)) {
        const list = vfs.readdirSync(pathStr);
        return list.map((item) => (typeof item === "string" ? item : item.name));
      }
      return originalReaddir(
        target as Parameters<typeof originalReaddir>[0],
        options as Parameters<typeof originalReaddir>[1],
      ) as string[];
    },
  );

  const statSpy = spyOn(mockFs, "statSync").mockImplementation((target: unknown) => {
    const pathStr = String(target);
    if (pathStr.startsWith(VFS_PREFIX)) {
      return vfs.statSync(pathStr);
    }
    return originalStat(target as Parameters<typeof originalStat>[0]);
  });

  function setupTestRoom(): void {
    vfs.reset();
    const logDir = `${VFS_PREFIX}/chatroom/rooms/alpha-room/log`;
    vfs.mkdirSync(logDir, { recursive: true });

    const env1 = makeEnvelope(1, "message", "chatroom.text.v1", "first message");
    const env2 = makeEnvelope(2, "verdict", "chatroom.verdict.v1", "verdict passed");
    const env3 = makeEnvelope(3, "message", "chatroom.text.v1", "second message");
    const env4 = makeEnvelope(4, "control", "chatroom.ping.v1", "ping");
    const env5 = makeEnvelope(5, "dispatch", "custom.special.v1", "custom body", {
      detail: "sample",
    });

    const segment1Lines = [env1, env2, env3].map((e) => JSON.stringify(e)).join("\n") + "\n";
    const segment2Lines = [env4, env5].map((e) => JSON.stringify(e)).join("\n") + "\n";

    vfs.writeFileSync(`${logDir}/000001.jsonl`, segment1Lines);
    vfs.writeFileSync(`${logDir}/000002.jsonl`, segment2Lines);
    vfs.writeFileSync(
      `${VFS_PREFIX}/chatroom/rooms/alpha-room/room.json`,
      JSON.stringify({ v: 1, id: "alpha-room", title: "Alpha Room" }),
    );
  }

  beforeEach(() => {
    process.env.CHATROOM_HOME = `${VFS_PREFIX}/chatroom`;
    setupTestRoom();
  });

  afterAll(() => {
    if (previousChatroomHome === undefined) {
      delete process.env.CHATROOM_HOME;
    } else {
      process.env.CHATROOM_HOME = previousChatroomHome;
    }
    existsSpy.mockRestore();
    readSpy.mockRestore();
    readdirSpy.mockRestore();
    statSpy.mockRestore();
  });

  it("reads all envelopes across segments in ascending order up to default limit", async () => {
    const result = await inspectCommand({ room: "alpha-room" }, {}, []);
    expect(result["count"]).toBe(5);
    const envs = result["envelopes"] as readonly Envelope[];
    expect(envs.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(envs[0]?.id).toBe("env-1");
    expect(envs[4]?.id).toBe("env-5");
  });

  it("filters envelopes by since seq filter (envelope.seq >= since)", async () => {
    const result = await inspectCommand({ room: "alpha-room", since: 3 }, {}, []);
    expect(result["count"]).toBe(3);
    const envs = result["envelopes"] as readonly Envelope[];
    expect(envs.map((e) => e.seq)).toEqual([3, 4, 5]);
  });

  it("filters envelopes by type matching envelope.kind", async () => {
    const result = await inspectCommand({ room: "alpha-room", type: "verdict" }, {}, []);
    expect(result["count"]).toBe(1);
    const envs = result["envelopes"] as readonly Envelope[];
    expect(envs[0]?.seq).toBe(2);
    expect(envs[0]?.kind).toBe("verdict");
  });

  it("filters envelopes by type matching envelope.body.schema", async () => {
    const result = await inspectCommand({ room: "alpha-room", type: "custom.special.v1" }, {}, []);
    expect(result["count"]).toBe(1);
    const envs = result["envelopes"] as readonly Envelope[];
    expect(envs[0]?.seq).toBe(5);
    expect(envs[0]?.body.schema).toBe("custom.special.v1");
  });

  it("respects limit parameter and stops after limit matches", async () => {
    const result = await inspectCommand({ room: "alpha-room", limit: 2 }, {}, []);
    expect(result["count"]).toBe(2);
    const envs = result["envelopes"] as readonly Envelope[];
    expect(envs.map((e) => e.seq)).toEqual([1, 2]);
  });

  it("combines since, type, and limit filters", async () => {
    const result = await inspectCommand(
      { room: "alpha-room", since: 2, type: "message", limit: 1 },
      {},
      [],
    );
    expect(result["count"]).toBe(1);
    const envs = result["envelopes"] as readonly Envelope[];
    expect(envs[0]?.seq).toBe(3);
  });

  it("verifies pure non-mutating inspection: no cursor created, no locks created, log unchanged", async () => {
    const logBefore = vfs.readFileSync(
      `${VFS_PREFIX}/chatroom/rooms/alpha-room/log/000001.jsonl`,
      "utf-8",
    );

    await inspectCommand({ room: "alpha-room" }, {}, []);

    const logAfter = vfs.readFileSync(
      `${VFS_PREFIX}/chatroom/rooms/alpha-room/log/000001.jsonl`,
      "utf-8",
    );
    expect(logAfter).toBe(logBefore);

    const readersExist = vfs.existsSync(`${VFS_PREFIX}/chatroom/rooms/alpha-room/readers`);
    expect(readersExist).toBe(false);

    const locksExist = vfs.existsSync(`${VFS_PREFIX}/chatroom/rooms/alpha-room/locks`);
    expect(locksExist).toBe(false);
  });

  it("formats line envelopes to stdout when json is false or omitted", async () => {
    let captured = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      captured += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    };

    try {
      await inspectCommand({ room: "alpha-room", limit: 2 }, {}, []);
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(captured).toContain("[1] <agent-1> first message\n");
    expect(captured).toContain("[2] <agent-1> verdict passed\n");
  });

  it("suppresses human stdout line formatting when json flag is true", async () => {
    let captured = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      captured += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    };

    try {
      await inspectCommand({ room: "alpha-room", json: true }, {}, []);
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(captured).toBe("");
  });

  it("throws UNKNOWN_ROOM when room does not exist", async () => {
    let caughtCode = "";
    try {
      await inspectCommand({ room: "missing-room" }, {}, []);
    } catch (err: unknown) {
      if (err instanceof ChatError) {
        caughtCode = err.code;
      }
    }
    expect(caughtCode).toBe("UNKNOWN_ROOM");
  });

  it("executes through main CLI entry point with chat:inspect and inspect alias", async () => {
    let capturedJson = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      capturedJson += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    };

    try {
      await main(["chat:inspect", "--room", "alpha-room", "--limit", "2", "--json"]);
    } finally {
      process.stdout.write = originalWrite;
    }

    const parsed = JSON.parse(capturedJson.trim()) as {
      room: string;
      count: number;
      envelopes: readonly unknown[];
    };
    expect(parsed.room).toBe("alpha-room");
    expect(parsed.count).toBe(2);
    expect(parsed.envelopes.length).toBe(2);

    let aliasCaptured = "";
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      aliasCaptured += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    };

    try {
      await main(["inspect", "--room", "alpha-room", "--since", "4", "--json"]);
    } finally {
      process.stdout.write = originalWrite;
    }

    const aliasParsed = JSON.parse(aliasCaptured.trim()) as {
      room: string;
      count: number;
      envelopes: readonly unknown[];
    };
    expect(aliasParsed.count).toBe(2);
  });
});
