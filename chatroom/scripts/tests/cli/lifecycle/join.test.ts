import { describe, expect, it } from "bun:test";
import { main } from "../../../../index.ts";

describe("CLI real entry point: chat:join", () => {
  it("executes full argv parsing, flag assertion, and entry pipeline with URI", async () => {
    let caughtCode = "";
    try {
      await main([
        "chat:join",
        "--invite",
        "chatroom://room-1#01234567.AAAAAAAAAAAAAAAAAAAAAAAAAA",
        "--yes",
        "--as",
        "agent-1",
      ]);
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        caughtCode = String((err as { code: unknown }).code);
      }
    }
    expect(caughtCode).toBe("UNKNOWN_ROOM");
  });

  it("renders help markdown cleanly when invoked with --help", async () => {
    let captured = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      captured += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    };

    try {
      await main(["chat:join", "--help"]);
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(captured.includes("chat:join")).toBe(true);
    expect(captured.includes("--invite")).toBe(true);
    expect(captured.includes("--yes")).toBe(true);
  });

  it("rejects unregistered flags at the CLI boundary with INVALID_ARGUMENT", async () => {
    let caughtCode = "";
    try {
      await main(["chat:join", "--room", "public-room", "--unknown-flag", "value"]);
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        caughtCode = String((err as { code: unknown }).code);
      }
    }
    expect(caughtCode).toBe("INVALID_ARGUMENT");
  });
});
