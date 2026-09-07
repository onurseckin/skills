import { afterAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { main } from "../../../index.ts";
import { ChatError, type MemberRecord } from "../../src/core/index.ts";
import * as roomModule from "../../src/room/index.ts";
import * as daemonModule from "../../src/daemon/index.ts";
import * as coreModule from "../../src/core/index.ts";
import * as cursorModule from "../../src/cursor/index.ts";

describe("CLI real entry point: chat:watch", () => {
  const dummyCursor: cursorModule.ReaderCursor = {
    v: 1,
    room: "room-1",
    reader: "agent-1",
    contiguous_seq: 0,
    held: [],
    acked_above: [],
    last_ack_at: null,
    last_ack_kind: null,
    updated_at: new Date().toISOString(),
    checksum: "sha256:init",
  };

  const assertMemberSpy = spyOn(roomModule, "assertMember").mockImplementation(
    (room, identity): MemberRecord => {
      const roomId = typeof room === "string" ? room : room.id;
      if (roomId === "room-unjoined") {
        throw new ChatError(
          "NOT_MEMBER",
          `identity '${typeof identity === "string" ? identity : identity.id}' is not a member of room '${roomId}'`,
        );
      }
      return {
        v: 1,
        id: typeof identity === "string" ? identity : identity.id,
        role: "worker",
        host: "local",
        joined_at: new Date().toISOString(),
      };
    },
  );

  const ensureDaemonSpy = spyOn(daemonModule, "ensureDaemon").mockImplementation(() => ({
    status: "running",
    healthy: true,
    probedMs: 0,
  }));

  const withLockSpy = spyOn(coreModule, "withLock").mockImplementation(
    <T>(_path: string, action: () => T): T => action(),
  );

  const loadCursorSpy = spyOn(cursorModule, "loadCursor").mockImplementation(() => ({
    cursor: dummyCursor,
    checksum: dummyCursor.checksum,
  }));

  const leaseNextSpy = spyOn(cursorModule, "leaseNext").mockImplementation(() => ({
    leaseId: null,
    messages: [],
    cursor: dummyCursor,
  }));

  beforeEach(() => {
    withLockSpy.mockClear();
    assertMemberSpy.mockClear();
    ensureDaemonSpy.mockClear();
    loadCursorSpy.mockClear();
    leaseNextSpy.mockClear();
  });

  afterAll(() => {
    assertMemberSpy.mockRestore();
    ensureDaemonSpy.mockRestore();
    withLockSpy.mockRestore();
    loadCursorSpy.mockRestore();
    leaseNextSpy.mockRestore();
  });

  it("executes full argv parsing, flag assertion, and entry pipeline", async () => {
    let caughtError: unknown;
    try {
      await main(["chat:watch", "--room", "room-1", "--timeout", "0", "--as", "agent-1"]);
    } catch (err: unknown) {
      caughtError = err;
    }
    expect(caughtError).toBeUndefined();
    expect(withLockSpy).toHaveBeenCalled();
  });

  it("fails with NOT_MEMBER when agent is not a member of room", async () => {
    let caughtCode = "";
    try {
      await main(["chat:watch", "--room", "room-unjoined", "--timeout", "10", "--as", "agent-1"]);
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        caughtCode = String((err as { code: unknown }).code);
      }
    }
    expect(caughtCode).toBe("NOT_MEMBER");
  });

  it("renders help markdown cleanly when invoked with --help", async () => {
    let captured = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      captured += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    };

    try {
      await main(["chat:watch", "--help"]);
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(captured.includes("chat:watch")).toBe(true);
    expect(captured.includes("--room")).toBe(true);
    expect(captured.includes("--timeout")).toBe(true);
  });

  it("fails with INVALID_ARGUMENT when required --room flag is omitted", async () => {
    let caughtCode = "";
    try {
      await main(["chat:watch", "--timeout", "500"]);
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        caughtCode = String((err as { code: unknown }).code);
      }
    }
    expect(caughtCode).toBe("INVALID_ARGUMENT");
  });

  it("rejects unregistered flags at the CLI boundary with INVALID_ARGUMENT", async () => {
    let caughtCode = "";
    try {
      await main(["chat:watch", "--room", "room-1", "--bogus-watch-flag"]);
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        caughtCode = String((err as { code: unknown }).code);
      }
    }
    expect(caughtCode).toBe("INVALID_ARGUMENT");
  });
});
