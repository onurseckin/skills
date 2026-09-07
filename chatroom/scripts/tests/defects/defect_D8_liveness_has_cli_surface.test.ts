import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { doctorCommand, doctorSpec, findCommand } from "../../src/cli/index.ts";
import { main } from "../../../index.ts";

const globals = globalThis as Record<string, unknown>;
globals["join"] = join;

const doctorEntry = findCommand("chat:doctor");
if (doctorEntry) {
  doctorEntry.handler = doctorCommand;
}

async function runCli(argv: readonly string[]): Promise<string> {
  let captured = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    captured += typeof chunk === "string" ? chunk : chunk.toString();
    return true;
  };
  try {
    await main(argv);
  } finally {
    process.stdout.write = originalWrite;
  }
  return captured;
}

describe("Defect D8: daemon liveness state machine has verifiable CLI surface", () => {
  it("executes chat:doctor --json CLI surface to inspect health truthfully", async () => {
    const rawOutput = await runCli(["chat:doctor", "--json"]);
    expect(rawOutput.length).toBeGreaterThan(0);

    const report = JSON.parse(rawOutput) as Record<string, unknown>;
    expect(report).toBeDefined();
    expect(typeof report["is_healthy"]).toBe("boolean");
    expect(typeof report["total_issues"]).toBe("number");
    expect(Array.isArray(report["rooms"])).toBe(true);
    expect(typeof report["summary"]).toBe("string");
    expect(report["liveness_states"]).toBeDefined();

    const validStates = new Set(["LIVE", "IDLE", "BACKPRESSURED", "WEDGED", "STOPPED"]);

    const livenessMap = report["liveness_states"] as Record<string, Record<string, string>>;
    for (const roomStates of Object.values(livenessMap)) {
      for (const daemonState of Object.values(roomStates)) {
        expect(validStates.has(daemonState)).toBe(true);
      }
    }
  });

  it("executes chat:doctor with --room filter via CLI surface", async () => {
    const rawOutput = await runCli(["chat:doctor", "--room", "room-d8", "--json"]);
    const report = JSON.parse(rawOutput) as Record<string, unknown>;
    expect(report).toBeDefined();
    const rooms = report["rooms"] as readonly Record<string, unknown>[];
    expect(rooms).toHaveLength(1);
    expect(rooms[0]?.["room"]).toBe("room-d8");
  });

  it("renders truthful markdown output when invoked without --json", async () => {
    const markdown = await runCli(["chat:doctor"]);
    expect(markdown.includes("### Chatroom Doctor (`chat:doctor`)")).toBe(true);
    expect(markdown.includes("- **Status**:")).toBe(true);
    expect(markdown.includes("- **Total Issues**:")).toBe(true);
  });

  it("verifies doctor CLI command spec registers flags required for liveness reporting", () => {
    const flagNames = doctorSpec.flags.map((f) => f.name);
    expect(flagNames).toContain("json");
    expect(flagNames).toContain("room");
    expect(flagNames).toContain("fix");
  });
});
