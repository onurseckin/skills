import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { main } from "../../../../index.ts";

describe("CLI real entry point: chat:init", () => {
  let prevChatroomHome: string | undefined;
  let testHome = "";

  beforeAll(async () => {
    prevChatroomHome = process.env.CHATROOM_HOME;
    const osMod = await import("node:os");
    const { join } = await import("node:path");
    testHome = join(osMod.tmpdir(), "chat-test-" + Date.now());
    process.env.CHATROOM_HOME = testHome;
  });

  afterAll(async () => {
    if (prevChatroomHome === undefined) {
      delete process.env.CHATROOM_HOME;
    } else {
      process.env.CHATROOM_HOME = prevChatroomHome;
    }
    if (testHome) {
      const virtualFs = await import("node:fs/promises");
      try {
        await virtualFs.rm(testHome, { recursive: true, force: true });
      } catch {}
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
      await main([
        "chat:init",
        "--room",
        "alpha-room",
        "--title",
        "Alpha Room",
        "--repo",
        "/tmp/chatroom-init-test",
        "--json",
      ]);
    } finally {
      process.stdout.write = originalWrite;
    }

    const parsed = JSON.parse(captured.trim()) as {
      room: string;
      as: string;
      host: string;
      status: string;
    };
    expect(parsed.room).toBe("alpha-room");
    expect(typeof parsed.as).toBe("string");
    expect(parsed.as.length).toBeGreaterThan(0);
    expect(typeof parsed.host).toBe("string");
    expect(parsed.status).toBe("provisioned");
  });

  it("renders help markdown cleanly when invoked with --help", async () => {
    let captured = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      captured += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    };

    try {
      await main(["chat:init", "--help"]);
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(captured.includes("chat:init")).toBe(true);
    expect(captured.includes("--room")).toBe(true);
  });

  it("rejects unregistered flags at the CLI boundary with INVALID_ARGUMENT", async () => {
    let caughtCode = "";
    try {
      await main(["chat:init", "--room", "alpha", "--unregistered-flag", "value"]);
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        caughtCode = String((err as { code: unknown }).code);
      }
    }
    expect(caughtCode).toBe("INVALID_ARGUMENT");
  });
});
