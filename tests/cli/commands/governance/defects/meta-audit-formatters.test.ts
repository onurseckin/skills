import { describe, expect, test } from "bun:test";
import {
  formatMetaAuditReport,
  renderEfficiencyMetricsTable,
  renderForensicsIncidentTable,
  type FeedbackInjectionResult,
  type ForensicsAnalysisReport,
  type ForensicsIncident,
} from "../../../../../olt/scripts/src/cli/commands/meta-audit.ts";

describe("CLI meta-audit formatters", () => {
  describe("renderForensicsIncidentTable", () => {
    test("returns placeholder when incidents array is empty", () => {
      const output = renderForensicsIncidentTable([]);
      expect(output).toEqual([
        "_No behavioral forensics incidents detected matching filter criteria._",
      ]);
    });

    test("formats table correctly with incident details and pipe escaping", () => {
      const incidents: ForensicsIncident[] = [
        {
          id: "INC-001",
          severity: "critical",
          category: "TOKEN_BURNING",
          agent_id: "agent-1",
          task_id: "task-1",
          observation: "Read | explore | scan",
          root_cause: "Repeated directory walk",
          remediation: "Pass | exact | anchor",
        },
        {
          id: "INC-002",
          severity: "low",
          category: "POLLING_WASTE",
          agent_id: undefined,
          task_id: undefined,
          observation: "Short sleep loops",
          root_cause: "Active wait",
          remediation: "Use reactive wakeup",
        },
      ];

      const rows = renderForensicsIncidentTable(incidents);
      expect(rows.length).toBeGreaterThan(0);
      const joined = rows.join("\n");
      expect(joined).toContain("`INC-001`");
      expect(joined).toContain("CRITICAL");
      expect(joined).toContain("`TOKEN_BURNING`");
      expect(joined).toContain("`agent-1`");
      expect(joined).toContain("Read \\| explore \\| scan");
      expect(joined).toContain("Pass \\| exact \\| anchor");
      expect(joined).toContain("`INC-002`");
      expect(joined).toContain("LOW");
      expect(joined).toContain("-");
    });
  });

  describe("renderEfficiencyMetricsTable", () => {
    test("formats metrics with present token waste and efficiency score", () => {
      const rows = renderEfficiencyMetricsTable({
        total_events_analyzed: 42,
        total_tool_calls: 15,
        exploration_reads_count: 3,
        polling_calls_count: 1,
        concurrency_bottlenecks_detected: 0,
        role_boundary_deviations: 0,
        total_token_waste_estimate: 1200,
        efficiency_score: 94.5,
      });

      const joined = rows.join("\n");
      expect(joined).toContain("42");
      expect(joined).toContain("15");
      expect(joined).toContain("3");
      expect(joined).toContain("1");
      expect(joined).toContain("1200");
      expect(joined).toContain("94.5%");
    });

    test("formats metrics with undefined token waste and efficiency score fallback", () => {
      const rows = renderEfficiencyMetricsTable({
        total_events_analyzed: 10,
        total_tool_calls: 5,
        exploration_reads_count: 0,
        polling_calls_count: 0,
        concurrency_bottlenecks_detected: 0,
        role_boundary_deviations: 0,
        total_token_waste_estimate: undefined,
        efficiency_score: undefined,
      });

      const joined = rows.join("\n");
      expect(joined).toContain("0");
      expect(joined).toContain("100%");
    });
  });

  describe("formatMetaAuditReport", () => {
    const baseReport: ForensicsAnalysisReport = {
      run_root: "/tmp/capsule-test",
      analyzed_at: "2026-08-24T00:00:00.000Z",
      agent_filter: undefined,
      summary: {
        total_incidents: 0,
        critical_count: 0,
        high_count: 0,
        medium_count: 0,
        low_count: 0,
        clean: true,
      },
      metrics: {
        total_events_analyzed: 5,
        total_tool_calls: 2,
        exploration_reads_count: 0,
        polling_calls_count: 0,
        concurrency_bottlenecks_detected: 0,
        role_boundary_deviations: 0,
      },
      incidents: [],
    };

    test("renders clean report without injection", () => {
      const markdown = formatMetaAuditReport({ report: baseReport });
      expect(markdown).toContain("🟢 CLEAN (No Behavioral Defects Detected)");
      expect(markdown).toContain("*all agents*");
      expect(markdown).toContain("Clean run — no remediations required.");
    });

    test("renders critical defects badge when critical incidents exist", () => {
      const report: ForensicsAnalysisReport = {
        ...baseReport,
        agent_filter: "coord-1",
        summary: {
          total_incidents: 1,
          critical_count: 1,
          high_count: 0,
          medium_count: 0,
          low_count: 0,
          clean: false,
        },
        incidents: [
          {
            id: "INC-CRIT-1",
            severity: "critical",
            category: "ROLE_BOUNDARY_DEVIATION",
            agent_id: "coord-1",
            task_id: "task-1",
            observation: "Coordinator attempted direct file write",
            root_cause: "Supervisor persona deviation",
            remediation: "Delegate write scope to implementer",
            impact: "High risk of state corruption",
          },
        ],
      };

      const markdown = formatMetaAuditReport({ report, verbose: true });
      expect(markdown).toContain("🔴 CRITICAL DEFECTS DETECTED");
      expect(markdown).toContain("`coord-1`");
      expect(markdown).toContain("Skipped (pass `--inject`");
      expect(markdown).toContain("#### Forensic Incident Details");
      expect(markdown).toContain("`INC-CRIT-1`");
      expect(markdown).toContain("**Impact**: High risk of state corruption");
    });

    test("renders warnings badge for non-critical incidents and includes injection status", () => {
      const report: ForensicsAnalysisReport = {
        ...baseReport,
        summary: {
          total_incidents: 2,
          critical_count: 0,
          high_count: 1,
          medium_count: 1,
          low_count: 0,
          clean: false,
        },
        incidents: [
          {
            id: "INC-WARN-1",
            severity: "high",
            category: "FALSE_SERIALIZATION",
            observation: "Independent waves serialized",
            root_cause: "Artificial dep chaining",
            remediation: "Decouple disjoint write scopes",
          },
        ],
      };

      const injection: FeedbackInjectionResult = {
        injected_count: 1,
        injected_items: ["REM-WARN-1"],
        queue_path: "/tmp/backlog.jsonl",
      };

      const markdown = formatMetaAuditReport({ report, injection });
      expect(markdown).toContain("🟡 WARNINGS DETECTED");
      expect(markdown).toContain("Injected 1 remediation task(s)");
      expect(markdown).toContain("`REM-WARN-1`");
    });
  });
});
