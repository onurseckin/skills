import { describe, it, expect } from "bun:test";
import { SubagentWatchdogTelemetryMonitor } from "../../../olt/scripts/src/reporting/subagent-watchdog-monitor.ts";

describe("SubagentWatchdogTelemetryMonitor", () => {
  it("detects polling waste and excessive turn counts", () => {
    const report = SubagentWatchdogTelemetryMonitor.evaluateHealth({
      agentId: "impl-1",
      turnCount: 30,
      recentCommands: ["sleep 5", "sleep 5", "sleep 5"],
    });

    expect(report.isHealthy).toBe(false);
    expect(report.detectedAnomalies).toContain("POLLING_WASTE");
    expect(report.detectedAnomalies).toContain("STRAGGLER");
  });
});
