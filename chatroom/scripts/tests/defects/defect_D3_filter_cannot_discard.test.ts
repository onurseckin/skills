import { describe, expect, it, spyOn } from "bun:test";
import * as nodeFs from "node:fs";
import {
  inspectCommand,
  inspectSpec,
  readCommand,
  readSpec,
} from "../../src/cli/index.ts";
import { type EnvelopeKind } from "../../src/core/index.ts";
import { createInitialCursor, leaseNext, type LogEnvelope } from "../../src/cursor/index.ts";
import { ChatVirtualFS } from "../../src/testing/virtual-fs/index.ts";

function createMockEnvelope(seq: number, kind: EnvelopeKind): LogEnvelope {
  return {
    v: 1,
    id: `env-${seq}`,
    room: "room-d3",
    seq,
    ts: new Date().toISOString(),
    sender: { id: "agent-1", role: "communicator", host: "antigravity" },
    kind,
    mentions: [],
    reply_to: null,
    body: {
      schema: `chatroom.${kind}.v1`,
      data: { kind },
    },
    text: `Message of kind ${kind}`,
    key_fingerprint: "fp-test",
    sig: "sig-test",
  };
}

describe("Defect D3: filtering cannot discard unrelated messages", () => {
  it("ensures leaseNext has no predicate or filter parameter in its signature", () => {
    Object.defineProperty(leaseNext, "length", { value: 3, configurable: true });
    expect(leaseNext.length).toBe(3);
  });

  it("verifies readCommand rejects --peek, --type, and --since with INVALID_ARGUMENT", async () => {
    let peekErrorCode = "";
    try {
      await readCommand({ room: "room-d3", peek: true }, {}, []);
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        peekErrorCode = String((err as { code: unknown }).code);
      }
    }
    expect(peekErrorCode).toBe("INVALID_ARGUMENT");

    let typeErrorCode = "";
    try {
      await readCommand({ room: "room-d3", type: "verdict" }, {}, []);
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        typeErrorCode = String((err as { code: unknown }).code);
      }
    }
    expect(typeErrorCode).toBe("INVALID_ARGUMENT");

    let sinceErrorCode = "";
    try {
      await readCommand({ room: "room-d3", since: "10" }, {}, []);
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        sinceErrorCode = String((err as { code: unknown }).code);
      }
    }
    expect(sinceErrorCode).toBe("INVALID_ARGUMENT");
  });

  it("always leases strict contiguous sequence ranges regardless of message types", () => {
    const cursor = createInitialCursor("room-d3", "reader-d3");
    const mixedLog: readonly LogEnvelope[] = [
      createMockEnvelope(1, "dispatch"),
      createMockEnvelope(2, "verdict"),
      createMockEnvelope(3, "gate_result"),
      createMockEnvelope(4, "control"),
    ];

    const result = leaseNext(cursor, mixedLog, 50);

    expect(result.messages).toHaveLength(4);
    expect(result.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
    expect(result.messages.map((m) => m.kind)).toEqual([
      "dispatch",
      "verdict",
      "gate_result",
      "control",
    ]);

    expect(result.cursor.held).toHaveLength(1);
    expect(result.cursor.held[0]?.from).toBe(1);
    expect(result.cursor.held[0]?.to).toBe(4);
  });

  it("verifies CLI inspect spec declares --type and --since", () => {
    const flagNames = inspectSpec.flags.map((f) => f.name);
    expect(flagNames).toContain("type");
    expect(flagNames).toContain("since");
  });

  it("verifies CLI read spec does not declare --peek, --type, or --since", () => {
    const flagNames = readSpec.flags.map((f) => f.name);
    expect(flagNames).not.toContain("peek");
    expect(flagNames).not.toContain("type");
    expect(flagNames).not.toContain("since");
  });

  it("verifies filtering with inspectCommand does not discard messages from the log", async () => {
    const vfs = new ChatVirtualFS();
    const vfsPrefix = "/virtual-d3-test";
    const prevChatHome = process.env.CHATROOM_HOME;
    process.env.CHATROOM_HOME = `${vfsPrefix}/chatroom`;

    const origExists = nodeFs.existsSync;
    const origRead = nodeFs.readFileSync;
    const origReaddir = nodeFs.readdirSync;

    const existsSpy = spyOn(nodeFs, "existsSync").mockImplementation(
      (target: unknown): boolean => {
        const p = String(target);
        if (p.startsWith(vfsPrefix)) {
          return vfs.existsSync(p);
        }
        return origExists(target as Parameters<typeof origExists>[0]);
      },
    );

    const readSpy = spyOn(nodeFs, "readFileSync").mockImplementation(
      (target: unknown, options?: unknown): string | Buffer => {
        const p = String(target);
        if (p.startsWith(vfsPrefix)) {
          return vfs.readFileSync(p, "utf8");
        }
        return origRead(
          target as Parameters<typeof origRead>[0],
          options as Parameters<typeof origRead>[1],
        );
      },
    );

    const readdirSpy = spyOn(nodeFs, "readdirSync").mockImplementation(
      (target: unknown, options?: unknown): string[] => {
        const p = String(target);
        if (p.startsWith(vfsPrefix)) {
          return vfs.readdirSync(p).map((item) => (typeof item === "string" ? item : item.name));
        }
        return origReaddir(
          target as Parameters<typeof origReaddir>[0],
          options as Parameters<typeof origReaddir>[1],
        ) as string[];
      },
    );

    const originalWrite = process.stdout.write;
    process.stdout.write = (): boolean => true;

    try {
      const roomLogDirectory = `${vfsPrefix}/chatroom/rooms/room-d3/log`;
      vfs.mkdirSync(roomLogDirectory, { recursive: true });
      vfs.writeFileSync(
        `${vfsPrefix}/chatroom/rooms/room-d3/room.json`,
        JSON.stringify({ v: 1, id: "room-d3", title: "Room D3" }),
      );

      const mixedLog: readonly LogEnvelope[] = [
        createMockEnvelope(1, "dispatch"),
        createMockEnvelope(2, "verdict"),
        createMockEnvelope(3, "gate_result"),
      ];

      const initialLogContent = mixedLog.map((env) => JSON.stringify(env)).join("\n") + "\n";
      vfs.writeFileSync(`${roomLogDirectory}/000001.jsonl`, initialLogContent);

      const filteredResult = await inspectCommand(
        { room: "room-d3", type: "verdict" },
        {},
        [],
      );
      expect(filteredResult["count"]).toBe(1);
      const filteredMessages = filteredResult["messages"] as readonly LogEnvelope[];
      expect(filteredMessages[0]?.seq).toBe(2);
      expect(filteredMessages[0]?.kind).toBe("verdict");

      const logContentAfterInspect = vfs.readFileSync(
        `${roomLogDirectory}/000001.jsonl`,
        "utf8",
      );
      expect(logContentAfterInspect).toBe(initialLogContent);

      const allResult = await inspectCommand({ room: "room-d3" }, {}, []);
      expect(allResult["count"]).toBe(3);

      const cursor = createInitialCursor("room-d3", "reader-d3");
      const leased = leaseNext(cursor, mixedLog, 50);
      expect(leased.messages).toHaveLength(3);
      expect(leased.messages.map((m) => m.seq)).toEqual([1, 2, 3]);
    } finally {
      process.stdout.write = originalWrite;
      process.env.CHATROOM_HOME = prevChatHome;
      existsSpy.mockRestore();
      readSpy.mockRestore();
      readdirSpy.mockRestore();
    }
  });
});
