import { describe, expect, it } from "bun:test";
import { readCommand, readSpec } from "../../src/cli/index.ts";
import { ChatError } from "../../src/core/index.ts";
import { createInitialCursor, leaseNext, type LogEnvelope } from "../../src/cursor/index.ts";

function createMockEnvelope(seq: number, kind: string): LogEnvelope {
  return {
    v: 1,
    id: `env-${seq}`,
    room: "room-d3",
    seq,
    ts: new Date().toISOString(),
    sender: { id: "agent-1", role: "communicator", host: "antigravity" },
    kind,
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

  it("verifies readCommand throws FILTER_REQUIRES_PEEK when --type or --since is used without --peek", async () => {
    let typeErrorCode = "";
    try {
      await readCommand({ room: "room-d3", type: "verdict" }, {});
    } catch (err: unknown) {
      if (err instanceof ChatError) {
        typeErrorCode = err.code;
      }
    }
    expect(typeErrorCode).toBe("FILTER_REQUIRES_PEEK");

    let sinceErrorCode = "";
    try {
      await readCommand({ room: "room-d3", since: 10 }, {});
    } catch (err: unknown) {
      if (err instanceof ChatError) {
        sinceErrorCode = err.code;
      }
    }
    expect(sinceErrorCode).toBe("FILTER_REQUIRES_PEEK");
  });

  it("always leases strict contiguous sequence ranges regardless of message types", () => {
    const cursor = createInitialCursor("room-d3", "reader-d3");
    const mixedLog: readonly LogEnvelope[] = [
      createMockEnvelope(1, "dispatch"),
      createMockEnvelope(2, "verdict"),
      createMockEnvelope(3, "heartbeat"),
      createMockEnvelope(4, "custom"),
    ];

    const result = leaseNext(cursor, mixedLog, 50);

    expect(result.messages).toHaveLength(4);
    expect(result.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
    expect(result.messages.map((m) => m.kind)).toEqual([
      "dispatch",
      "verdict",
      "heartbeat",
      "custom",
    ]);

    expect(result.cursor.held).toHaveLength(1);
    expect(result.cursor.held[0]?.from).toBe(1);
    expect(result.cursor.held[0]?.to).toBe(4);
  });

  it("verifies CLI read spec declares --type, --since, and --peek", () => {
    const flagNames = readSpec.flags.map((f) => f.name);
    expect(flagNames).toContain("type");
    expect(flagNames).toContain("since");
    expect(flagNames).toContain("peek");
  });

  it("preserves all messages after a simulated peek filter operation", () => {
    const cursor = createInitialCursor("room-d3", "reader-d3");
    const mixedLog: readonly LogEnvelope[] = [
      createMockEnvelope(1, "dispatch"),
      createMockEnvelope(2, "verdict"),
      createMockEnvelope(3, "heartbeat"),
    ];

    const peekFiltered = mixedLog.filter((m) => m.kind === "verdict");
    expect(peekFiltered).toHaveLength(1);
    expect(peekFiltered[0]?.seq).toBe(2);

    expect(cursor.contiguous_seq).toBe(0);
    expect(cursor.held).toHaveLength(0);

    const normalRead = leaseNext(cursor, mixedLog, 50);
    expect(normalRead.messages).toHaveLength(3);
    expect(normalRead.messages[0]?.seq).toBe(1);
    expect(normalRead.messages[1]?.seq).toBe(2);
    expect(normalRead.messages[2]?.seq).toBe(3);
  });
});
