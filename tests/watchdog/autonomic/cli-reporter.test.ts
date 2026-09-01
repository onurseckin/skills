import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { formatCliStatusReport } from "../../../olt/scripts/src/watchdog/autonomic-watchdog/cli-reporter.ts";
import type { WatchdogHealthAuditReport } from "../../../olt/scripts/src/watchdog/autonomic-watchdog/types.ts";
import { cleanupVirtualWatchdogFS, setupVirtualWatchdogFS } from "../watchdog-fixture.ts";

beforeEach(() => {
  setupVirtualWatchdogFS();
});

afterEach(() => {
  cleanupVirtualWatchdogFS();
});

describe("formatCliStatusReport Markdown Generation", () => {
  it("formats a healthy status report cleanly without findings section", () => {
    const health: WatchdogHealthAuditReport = {
      healthy: true,
      timestamp: "2026-08-20T12:00:00.000Z",
      activeLeasesCount: 2,
      stalledAgentsCount: 0,
      deadProcessesCount: 0,
      subagentCount: 2,
      bootGateCompliantCount: 2,
      bootGateViolationsCount: 0,
      tierViolationsCount: 0,
      findings: [],
      summary: "Autonomic watchdog healthy: 2 subagents compliant, 2 active monitors.",
    };

    const table =
      "| Agent ID | Role | Whoami | Doctor |\n|---|---|---|---|\n| ag-1 | impl | ✅ | ✅ |";
    const report = formatCliStatusReport(health, table);

    expect(report).toContain("### Autonomic Watchdog Status & Boot-Gate Enforcer");
    expect(report).toContain("- **Overall Health**: HEALTHY ✅");
    expect(report).toContain("- **Boot-Gate Compliant**: 2/2");
    expect(report).toContain(table);
    expect(report).not.toContain("#### Active Watchdog Findings");
  });

  it("formats an unhealthy status report with structured active findings", () => {
    const health: WatchdogHealthAuditReport = {
      healthy: false,
      timestamp: "2026-08-20T12:00:00.000Z",
      activeLeasesCount: 1,
      stalledAgentsCount: 1,
      deadProcessesCount: 1,
      subagentCount: 3,
      bootGateCompliantCount: 1,
      bootGateViolationsCount: 2,
      tierViolationsCount: 0,
      findings: [
        {
          id: "f-1",
          violationType: "stalled_agent",
          severity: "critical",
          observation: "Agent 'ag-stalled' has exceeded watchdog heartbeat timeout.",
          remediation: "Issue auto-wake pulse.",
          timestamp: "2026-08-20T12:00:00.000Z",
        },
      ],
      summary: "Autonomic watchdog detected issues.",
    };

    const table = "| Table Content |";
    const report = formatCliStatusReport(health, table);

    expect(report).toContain("- **Overall Health**: UNHEALTHY ❌");
    expect(report).toContain("#### Active Watchdog Findings");
    expect(report).toContain(
      "- [CRITICAL] **stalled_agent**: Agent 'ag-stalled' has exceeded watchdog heartbeat timeout.",
    );
  });
});
