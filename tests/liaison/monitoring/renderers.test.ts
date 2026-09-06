import { describe, expect, it } from "bun:test";
import {
  renderCli,
  renderJson,
  renderMarkdown,
  renderMonitoringSnapshot,
} from "../../../olt/scripts/src/liaison/monitoring/renderers.ts";
import { buildMonitoringSnapshot } from "../../../olt/scripts/src/liaison/monitoring/surface.ts";
import type {
  DriftItem,
  MonitoringSnapshot,
  SharedMetricItem,
  SystemLivenessInfo,
  SystemObligationSummary,
  SystemRosterMetrics,
  SystemRunStateInfo,
} from "../../../olt/scripts/src/liaison/monitoring/types.ts";

export const renderersSuiteName = "Monitoring Surface Renderers (CLI, Markdown, JSON)";

describe(renderersSuiteName, () => {
  const sampleLiveness: SystemLivenessInfo = Object.freeze({
    systemId: "antigravity",
    lastHeartbeatTimestamp: "2026-09-06T00:00:00.000Z",
    ageSeconds: 4,
    declaredIntervalSeconds: 15,
    consecutiveMissedBeats: 0,
    status: "ALIVE",
    statusMessage: "Operational and listening",
    activeRunIds: Object.freeze(["cross-system-communication-system"]),
  });

  const sampleRoster: SystemRosterMetrics = Object.freeze({
    activeAgents: Object.freeze([
      { agentId: "liaison_antigravity", roleType: "liaison", status: "active" },
      {
        agentId: "implementer_task-1",
        roleType: "implementer",
        laneId: "lane-1",
        status: "active",
      },
      {
        agentId: "implementer_task-2",
        roleType: "implementer",
        laneId: "lane-2",
        status: "active",
      },
    ]),
    totalActiveAgents: 3,
    implementerCount: 2,
    distinctImplementers: 2,
    distinctImplementerIdentities: Object.freeze(["implementer_task-1", "implementer_task-2"]),
    laneCount: 2,
    lanesPerImplementerRatio: 1.0,
    isSerialExecutionRisk: false,
    serialExecutionWarning: null,
  });

  const sampleObligations: SystemObligationSummary = Object.freeze({
    obligations: Object.freeze([
      {
        directive: {
          directiveId: "dir_101",
          correlationId: "corr_wave42",
          senderId: "claude-planner",
          recipientId: "liaison_antigravity",
          timestamp: "2026-09-06T00:00:00.000Z",
          description: "Align button tokens",
          namedPaths: Object.freeze(["src/tokens/button.ts"]),
          overdueWindowSeconds: 300,
        },
        bindingState: "bound",
        deliveredAt: "2026-09-06T00:01:00.000Z",
        boundAt: "2026-09-06T00:02:00.000Z",
        proof: {
          taskId: "task-button-tokens",
          boundScopePaths: Object.freeze(["src/tokens"]),
        },
        refusalReason: null,
        isOverdue: false,
        elapsedSeconds: 60,
      },
      {
        directive: {
          directiveId: "dir_102",
          correlationId: "corr_wave42",
          senderId: "claude-planner",
          recipientId: "liaison_antigravity",
          timestamp: "2026-09-06T00:00:00.000Z",
          description: "Update deprecated icon",
          namedPaths: Object.freeze(["src/icons/old.svg"]),
          overdueWindowSeconds: 300,
        },
        bindingState: "refused",
        deliveredAt: "2026-09-06T00:01:00.000Z",
        boundAt: null,
        proof: null,
        refusalReason: "Icons are owned by design system repository",
        isOverdue: false,
        elapsedSeconds: 60,
      },
    ]),
    totalObligations: 2,
    openCount: 0,
    boundCount: 1,
    refusedCount: 1,
    overdueCount: 0,
  });

  const sampleRunState: SystemRunStateInfo = Object.freeze({
    runId: "cross-system-communication-system",
    status: "running",
    lanes: Object.freeze([
      {
        laneId: "lane-1",
        status: "running",
        leaseHolder: "implementer_task-1",
        writeScope: Object.freeze(["src/tokens"]),
      },
      {
        laneId: "lane-2",
        status: "running",
        leaseHolder: "implementer_task-2",
        writeScope: Object.freeze(["src/components"]),
      },
    ]),
    unclaimedReadyLanes: Object.freeze([]),
    activeLeaseHolders: Object.freeze(["implementer_task-1", "implementer_task-2"]),
    totalLanes: 2,
  });

  const sampleMetrics: readonly SharedMetricItem[] = Object.freeze([
    {
      name: "localUiImportsTier1",
      value: 142,
      unit: "imports",
      computationDefinition: 'imports matching exact "@limo/design-system*" AST specifiers',
      computedAt: "2026-09-06T00:00:00.000Z",
      authority: "liaison_daemon",
    },
  ]);

  const sampleDrift: readonly DriftItem[] = Object.freeze([
    {
      metricName: "lintErrors",
      baselineValue: 5,
      currentValue: 0,
      delta: -5,
      direction: "improved",
      isRegression: false,
      absorbedRegressionAllowed: false,
    },
  ]);

  const snapshot: MonitoringSnapshot = buildMonitoringSnapshot({
    systemId: "antigravity",
    liveness: sampleLiveness,
    roster: sampleRoster,
    obligations: sampleObligations,
    runState: sampleRunState,
    sharedMetrics: sampleMetrics,
    drift: sampleDrift,
  });

  describe("renderCli", () => {
    it("renders plain-text CLI view with all critical sections", () => {
      const cli = renderCli(snapshot, { includeAnsiColors: false });

      expect(cli).toContain("=== CROSS-SYSTEM MONITORING: antigravity ===");
      expect(cli).toContain("Health: [HEALTHY]");
      expect(cli).toContain("Working Well: YES");
      expect(cli).toContain("--- LIVENESS ---");
      expect(cli).toContain("Status: ALIVE");
      expect(cli).toContain("--- ROSTER & CONCURRENCY ---");
      expect(cli).toContain("Distinct Implementers: 2");
      expect(cli).toContain("Lane Count: 2");
      expect(cli).toContain("Ratio: 1");
      expect(cli).toContain("--- OBLIGATIONS ---");
      expect(cli).toContain("dir_101");
      expect(cli).toContain("task-button-tokens");
      expect(cli).toContain("Icons are owned by design system repository");
      expect(cli).toContain("--- RUN STATE ---");
      expect(cli).toContain("--- SHARED METRICS (Single Computed Truth) ---");
      expect(cli).toContain("localUiImportsTier1 = 142 imports");
      expect(cli).toContain("--- DRIFT & RATCHETS ---");
      expect(cli).toContain("lintErrors");
    });

    it("includes ANSI color escapes when includeAnsiColors is true", () => {
      const cli = renderCli(snapshot, { includeAnsiColors: true });

      expect(cli).toContain("\x1b[");
      expect(cli).toContain("\x1b[32m"); // green for healthy/alive
    });
  });

  describe("renderMarkdown", () => {
    it("renders GitHub-flavored Markdown with alert boxes and tables", () => {
      const md = renderMarkdown(snapshot);

      expect(md).toContain("# Cross-System Monitoring Surface: `antigravity`");
      expect(md).toContain("> [!NOTE]");
      expect(md).toContain("**Status:** HEALTHY");
      expect(md).toContain("## Liveness");
      expect(md).toContain("## Roster & Concurrency");
      expect(md).toContain("| **Distinct Implementers** | `2` |");
      expect(md).toContain("| **Lane Count** | `2` |");
      expect(md).toContain("## Obligations & Protocol Binding");
      expect(md).toContain("| `dir_101` |");
      expect(md).toContain("## Shared Metrics (Single Computed Truth)");
      expect(md).toContain("## Ratchet & Gate Drift");
    });
  });

  describe("renderJson", () => {
    it("renders parseable JSON matching snapshot schema", () => {
      const jsonStr = renderJson(snapshot);
      const parsed = JSON.parse(jsonStr) as MonitoringSnapshot;

      expect(parsed.systemId).toBe("antigravity");
      expect(parsed.roster.distinctImplementers).toBe(2);
      expect(parsed.obligations.boundCount).toBe(1);
      expect(parsed.health.isWorkingWell).toBe(true);
    });
  });

  describe("renderMonitoringSnapshot (dispatcher)", () => {
    it("dispatches to CLI, Markdown, and JSON appropriately", () => {
      const cli = renderMonitoringSnapshot(snapshot, { format: "cli" });
      expect(cli).toContain("=== CROSS-SYSTEM MONITORING");

      const md = renderMonitoringSnapshot(snapshot, { format: "markdown" });
      expect(md).toContain("# Cross-System Monitoring Surface");

      const json = renderMonitoringSnapshot(snapshot, { format: "json" });
      expect(json.startsWith("{")).toBe(true);
    });
  });
});
