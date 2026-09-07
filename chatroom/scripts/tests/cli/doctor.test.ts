import { describe, expect, it } from "bun:test";
import { main } from "../../../index.ts";

describe("CLI real entry point: chat:doctor", () => {
  it("executes full argv parsing, flag assertion, and entry pipeline", async () => {
    let captured = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      captured += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    };

    try {
      await main(["chat:doctor", "--room", "room-1", "--fix", "--json"]);
    } finally {
      process.stdout.write = originalWrite;
    }

    const parsed = JSON.parse(captured.trim()) as {
      is_healthy: boolean;
      total_issues: number;
      rooms: readonly unknown[];
      repairs?: readonly unknown[];
      summary: unknown;
    };
    expect(typeof parsed.is_healthy).toBe("boolean");
    expect(typeof parsed.total_issues).toBe("number");
    expect(Array.isArray(parsed.rooms)).toBe(true);
    expect(Array.isArray(parsed.repairs)).toBe(true);
    expect(parsed.summary).toBeDefined();
  });

  it("renders help markdown cleanly when invoked with --help", async () => {
    let captured = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      captured += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    };

    try {
      await main(["chat:doctor", "--help"]);
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(captured.includes("chat:doctor")).toBe(true);
    expect(captured.includes("--fix")).toBe(true);
    expect(captured.includes("--room")).toBe(true);
  });

  it("rejects unregistered flags at the CLI boundary with INVALID_ARGUMENT", async () => {
    let caughtCode = "";
    try {
      await main(["chat:doctor", "--room", "room-1", "--unknown-doctor-flag"]);
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err) {
        caughtCode = String((err as { code: unknown }).code);
      }
    }
    expect(caughtCode).toBe("INVALID_ARGUMENT");
  });
});
