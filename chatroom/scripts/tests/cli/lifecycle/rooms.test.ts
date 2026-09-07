import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { main } from "../../../../index.ts";

describe("CLI real entry point: chat:rooms", () => {
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
    let captured = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      captured += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    };

    try {
      await main(["chat:rooms", "--mine", "--json"]);
    } finally {
      process.stdout.write = originalWrite;
    }

    const parsed = JSON.parse(captured.trim()) as {
      rooms: readonly unknown[];
      count: number;
    };
    expect(Array.isArray(parsed.rooms)).toBe(true);
    expect(typeof parsed.count).toBe("number");
    expect(parsed.count).toBe(parsed.rooms.length);
  });

  it("renders help markdown cleanly when invoked with --help", async () => {
    let captured = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      captured += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    };

    try {
      await main(["chat:rooms", "--help"]);
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(captured.includes("chat:rooms")).toBe(true);
    expect(captured.includes("--mine")).toBe(true);
  });

  it("rejects unregistered flags at the CLI boundary with INVALID_ARGUMENT", async () => {
    let caughtCode = "";
    try {
      await main(["chat:rooms", "--bogus-flag"]);
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        caughtCode = String((err as { code: unknown }).code);
      }
    }
    expect(caughtCode).toBe("INVALID_ARGUMENT");
  });
});
