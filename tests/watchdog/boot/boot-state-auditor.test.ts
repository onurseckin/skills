import { describe, expect, it } from "bun:test";
import { BootGateEnforcer } from "../../../olt/scripts/src/watchdog/boot-gate-enforcer/index.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";

describe("BootGateEnforcer State Machine Auditing", () => {
  it("audits boot gate compliance from capsule state object", () => {
    const enforcer = new BootGateEnforcer();
    const state: JsonObject = {
      agents: [
        {
          id: "impl-compliant",
          role: "implementer",
          parent_agent_id: "coord-01",
          granted_at: "2026-08-22T00:00:00.000Z",
        },
        {
          id: "impl-rogue",
          role: "implementer",
          parent_agent_id: "coord-01",
          granted_at: "2026-08-22T00:01:00.000Z",
        },
      ],
      commands: {
        "cmd-01": {
          id: "cmd-01",
          actor: "impl-compliant",
          argv: ["bun", "harness.ts", "whoami"],
          started_at: "2026-08-22T00:00:10.000Z",
          exit_code: 0,
        },
        "cmd-02": {
          id: "cmd-02",
          actor: "impl-compliant",
          argv: ["bun", "harness.ts", "doctor"],
          started_at: "2026-08-22T00:00:20.000Z",
          exit_code: 0,
        },
      },
    };

    const records = enforcer.auditSubagentBootGatesFromState(state);
    expect(records.length).toBe(2);
    expect(enforcer.getRecord("impl-compliant")?.bootGatePassed).toBe(true);
    expect(enforcer.getRecord("impl-rogue")?.bootGatePassed).toBe(false);

    const findings = enforcer.auditFindings(records);
    expect(findings.length).toBe(1);
    expect(findings[0]?.agentId).toBe("impl-rogue");
    expect(findings[0]?.violationType).toBe("boot_gate_missing");
  });

  it("handles null, undefined, or empty state gracefully without errors", () => {
    const enforcer = new BootGateEnforcer();
    expect(enforcer.auditSubagentBootGatesFromState(null)).toEqual([]);
    expect(enforcer.auditSubagentBootGatesFromState(undefined)).toEqual([]);
    expect(enforcer.auditSubagentBootGatesFromState({})).toEqual([]);
  });
});
