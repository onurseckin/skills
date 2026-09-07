import { describe, expect, it } from "bun:test";
import { main } from "../../../index.ts";

describe("CLI real entry point: chat:watch", () => {
  it("executes full argv parsing, flag assertion, and entry pipeline", async () => {
    let caughtCode = "";
    try {
      await main(["chat:watch", "--room", "room-1", "--timeout", "100", "--as", "agent-1"]);
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
    expect(captured.includes("--ack-mode")).toBe(true);
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
