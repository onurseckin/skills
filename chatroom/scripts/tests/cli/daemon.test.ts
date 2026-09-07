import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { main } from "../../../index.ts";

describe("CLI real entry point: chat:daemon", () => {
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
      await main(["chat:daemon", "--room", "room-1", "--status", "--as", "agent-1"]);
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
      await main(["chat:daemon", "--help"]);
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(captured.includes("chat:daemon")).toBe(true);
    expect(captured.includes("--start")).toBe(true);
    expect(captured.includes("--stop")).toBe(true);
    expect(captured.includes("--status")).toBe(true);
  });

  it("fails with INVALID_ARGUMENT when required --room flag is omitted", async () => {
    let caughtCode = "";
    try {
      await main(["chat:daemon", "--status"]);
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
      await main(["chat:daemon", "--room", "room-1", "--status", "--not-a-daemon-flag"]);
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        caughtCode = String((err as { code: unknown }).code);
      }
    }
    expect(caughtCode).toBe("INVALID_ARGUMENT");
  });
});
