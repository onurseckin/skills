import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { main } from "../../../index.ts";

describe("CLI real entry point: chat:ack", () => {
  let prevChatroomHome: string | undefined;

  beforeAll(() => {
    prevChatroomHome = process.env.CHATROOM_HOME;
    process.env.CHATROOM_HOME = `/virtual/chat-test-${Date.now()}`;
  });

  afterAll(() => {
    if (prevChatroomHome === undefined) {
      delete process.env.CHATROOM_HOME;
    } else {
      process.env.CHATROOM_HOME = prevChatroomHome;
    }
  });
  it("executes full argv parsing, flag assertion, and entry pipeline", async () => {
    let caughtCode = "";
    try {
      await main(["chat:ack", "--room", "room-1", "--lease", "lease-123", "--as", "agent-1"]);
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
      await main(["chat:ack", "--help"]);
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(captured.includes("chat:ack")).toBe(true);
    expect(captured.includes("--lease")).toBe(true);
    expect(captured.includes("--through")).toBe(true);
  });

  it("fails with INVALID_ARGUMENT when required --room flag is omitted", async () => {
    let caughtCode = "";
    try {
      await main(["chat:ack", "--lease", "lease-123"]);
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
      await main(["chat:ack", "--room", "room-1", "--lease", "l-1", "--unknown-flag"]);
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        caughtCode = String((err as { code: unknown }).code);
      }
    }
    expect(caughtCode).toBe("INVALID_ARGUMENT");
  });
});
