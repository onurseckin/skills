import { describe, expect, it } from "bun:test";
import {
  formatForensicsReport,
  renderForensicsAsciiTable,
  type ForensicsAnalysisResult,
  type ForensicsIncident,
  type ForensicsMetrics,
} from "../../../../olt/scripts/src/mind/auditing/meta/index.ts";

describe("Meta Auditor - Forensics Report & Table Formatters", () => {
  describe("Forensics Report & ASCII Table Formatters", () => {
    it("renders ASCII table correctly for empty and non-empty incidents", () => {
      const emptyTable = renderForensicsAsciiTable([]);
      expect(emptyTable).toContain("No forensics incidents detected. Run is fully compliant.");

      const incidents: readonly ForensicsIncident[] = [
        {
          id: "inc-tb-12345678",
          category: "TOKEN_BURNING",
          severity: "HIGH",
          title: "Excessive Exploratory Browsing",
          description: "Over 10 reads",
          observation: "Over 10 reads",
          remediation: "Anchors",
          recommendation: "Anchors",
          agentId: "agent-1",
        },
      ];

      const asciiTable = renderForensicsAsciiTable(incidents);
      expect(asciiTable).toContain("TOKEN_BURNING");
      expect(asciiTable).toContain("HIGH");
      expect(asciiTable).toContain("agent-1");
      expect(asciiTable).toContain("Excessive Exploratory");
    });

    it("formats comprehensive markdown report for clean and deviation runs", () => {
      const cleanMetrics: ForensicsMetrics = {
        totalAgents: 3,
        totalTasks: 3,
        totalEvents: 25,
        totalTokensIn: 12000,
        totalTokensOut: 4500,
        totalToolCalls: 12,
        fileReadCount: 6,
        fileWriteCount: 6,
        readToWriteRatio: 1.0,
        pollingCallsCount: 0,
        sequentialWaveBottlenecks: 0,
        boundaryDeviationsCount: 0,
        stragglerTasksCount: 0,
        ghostLeasesCount: 0,
        contextOverflowCount: 0,
        efficiencyScore: 100.0,
        total_events_analyzed: 25,
        total_tool_calls: 12,
        exploration_reads_count: 6,
        polling_calls_count: 0,
        concurrency_bottlenecks_detected: 0,
        role_boundary_deviations: 0,
        total_token_waste_estimate: 0,
        incidentCountsByCategory: {
          TOKEN_BURNING: 0,
          FALSE_SERIALIZATION: 0,
          ROLE_BOUNDARY_DEVIATION: 0,
          POLLING_WASTE: 0,
          CONTEXT_OVERFLOW: 0,
          GHOST_LEASE: 0,
          STRAGGLER: 0,
        },
        incidentCountsBySeverity: {
          CRITICAL: 0,
          HIGH: 0,
          MEDIUM: 0,
          LOW: 0,
        },
      };

      const cleanResult: ForensicsAnalysisResult = {
        runId: "run-clean-01",
        capsuleRoot: "/capsules/run-clean-01",
        run_root: "/capsules/run-clean-01",
        analyzedAt: "2026-08-23T00:00:00.000Z",
        analyzed_at: "2026-08-23T00:00:00.000Z",
        isClean: true,
        efficiencyScore: 100.0,
        summary: {
          clean: true,
          total_incidents: 0,
          critical_count: 0,
          high_count: 0,
          medium_count: 0,
          low_count: 0,
          text: "Run `run-clean-01` achieved high behavioral efficiency",
          toString(): string {
            return this.text;
          },
        },
        metrics: cleanMetrics,
        incidents: [],
        proposals: [],
      };

      const cleanReport = formatForensicsReport(cleanResult);
      expect(cleanReport).toContain("# Skill Meta-Auditor Deep Behavioral Forensics Report");
      expect(cleanReport).toContain("run-clean-01");
      expect(cleanReport).toContain("CLEAN / OPTIMIZED");
      expect(cleanReport).toContain(
        "No behavioral deviations, token burning, or concurrency bottlenecks",
      );
      expect(cleanReport).toContain("No remediation proposals required.");

      const deviationResult: ForensicsAnalysisResult = {
        ...cleanResult,
        runId: "run-dev-01",
        isClean: false,
        efficiencyScore: 65.0,
        incidents: [
          {
            id: "inc-pw-01",
            category: "POLLING_WASTE",
            severity: "HIGH",
            title: "Polling Loop Detected",
            description: "Polled status 12 times",
            observation: "Obs",
            remediation: "Rem",
            recommendation: "Use reactive sleep",
            agentId: "agent-poll",
            taskId: "task-poll-1",
          },
        ],
        proposals: [
          {
            id: "prop-pw-01",
            title: "Mandate Standard Async WaitMsBeforeAsync",
            content: "Content",
            priority: "HIGH_ARCHITECTURAL_FEATURE",
            category: "CLI_TOOLING",
            rootCause: "POLLING_WASTE",
            remediationDirective: "Use WaitMsBeforeAsync 10000",
          },
        ],
      };

      const devReport = formatForensicsReport(deviationResult);
      expect(devReport).toContain("DEVIATIONS DETECTED");
      expect(devReport).toContain("[HIGH] Polling Loop Detected");
      expect(devReport).toContain("Mandate Standard Async WaitMsBeforeAsync");
    });
  });
});
