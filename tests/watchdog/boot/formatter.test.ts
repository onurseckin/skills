import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { BootGateEnforcer } from "../../../olt/scripts/src/watchdog/boot-gate-enforcer/index.ts";
import { renderAsciiBootGateTable } from "../../../olt/scripts/src/watchdog/boot-gate-enforcer/formatter.ts";
import { cleanupVirtualWatchdogFS, setupVirtualWatchdogFS } from "../watchdog-fixture.ts";

beforeEach(() => {
  setupVirtualWatchdogFS();
});

afterEach(() => {
  cleanupVirtualWatchdogFS();
});

describe("BootGateEnforcer ASCII Table Formatter", () => {
  it("renders notice message when records list is empty", () => {
    expect(renderAsciiBootGateTable([])).toBe("No subagents registered in boot gate tracker.");
  });

  it("renders formatted ASCII table with headers and record columns", () => {
    const enforcer = new BootGateEnforcer();
    enforcer.registerSpawnedSubagent({
      agentId: "agent-table-demo",
      role: "implementer",
      pid: 1234,
    });
    enforcer.recordWhoamiExecution("agent-table-demo");
    enforcer.recordDoctorExecution("agent-table-demo");

    const table = enforcer.renderAsciiBootGateTable();
    expect(table).toContain("| Agent ID");
    expect(table).toContain("| Tier | Role");
    expect(table).toContain("agent-table-demo");
    expect(table).toContain("PASS ✅");
    expect(table).toContain("READY ✅");
  });
});
