import { describe, expect, it } from "bun:test";
import { main } from "../../../index.ts";
import { formatProvisioningDrift, type ProvisionReport } from "../../src/doctor/index.ts";

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

describe("chat:doctor provisioning drift names its subject", () => {
  function receipt(overrides: Partial<ProvisionReport>): ProvisionReport {
    return {
      host: "antigravity",
      member: "alice",
      path: "/rooms/room-drift/provision/antigravity.alice.json",
      is_valid: false,
      agent_exists: false,
      daemon_alive: false,
      drift_detected: true,
      issues: ["communicator agent artifact missing"],
      ...overrides,
    };
  }

  it("names every drifted member and what drifted, never a bare boolean", () => {
    const drift = formatProvisioningDrift([
      receipt({}),
      receipt({
        host: "claude_code",
        member: "bob",
        path: "/rooms/room-drift/provision/claude_code.bob.json",
        issues: ["daemon is not live for provisioned member"],
      }),
    ]);

    expect(drift).toEqual([
      "alice@antigravity (communicator agent artifact missing)",
      "bob@claude_code (daemon is not live for provisioned member)",
    ]);
  });

  it("joins multiple drift reasons for a single member", () => {
    const drift = formatProvisioningDrift([
      receipt({
        issues: [
          "communicator agent artifact missing",
          "daemon is not live for provisioned member",
        ],
      }),
    ]);

    expect(drift).toEqual([
      "alice@antigravity (communicator agent artifact missing; daemon is not live for provisioned member)",
    ]);
  });

  it("falls back to the receipt path when the receipt is too corrupt to carry a member", () => {
    const drift = formatProvisioningDrift([
      receipt({
        host: "",
        member: "",
        path: "/rooms/room-drift/provision/antigravity.ghost.json",
        issues: ["corrupt provisioning receipt"],
      }),
    ]);

    expect(drift).toEqual([
      "/rooms/room-drift/provision/antigravity.ghost.json (corrupt provisioning receipt)",
    ]);
  });

  it("emits nothing when no receipt drifted", () => {
    expect(
      formatProvisioningDrift([
        receipt({ is_valid: true, agent_exists: true, drift_detected: false, issues: [] }),
      ]),
    ).toEqual([]);
  });
});
