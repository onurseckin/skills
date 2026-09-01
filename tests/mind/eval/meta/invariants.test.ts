import { describe, expect, it } from "bun:test";
import {
  analyzeRunForensics,
  calculateEfficiencyScore,
  formatForensicsReport,
  injectRemediationToFeedbackQueue,
  isPollTool,
  isReadTool,
  isWriteTool,
  renderForensicsAsciiTable,
  synthesizeRemediationPlan,
  ROOT_CAUSE_CATEGORIES,
  FORENSICS_SEVERITIES,
  type AnalyzeRunForensicsOptions,
  type FeedbackInjectionOptions,
  type ForensicsAnalysisResult,
  type ForensicsIncident,
  type ForensicsMetrics,
  type ForensicsSeverity,
  type PlanInjectionProposal,
  type RootCauseCategory,
} from "../../../../olt/scripts/src/mind/auditing/meta/index.ts";
import {
  formatMetaAuditReport,
  metaAuditCommand,
  renderEfficiencyMetricsTable,
  renderForensicsIncidentTable,
} from "../../../../olt/scripts/src/cli/commands/meta-audit.ts";
import type { AgentGrantRecord } from "../../../../olt/scripts/src/core/contracts/index.ts";
import type { Manifest, RunState } from "../../../../olt/scripts/src/core/contracts/index.ts";
import {
  __setFeedbackQueuePersistenceTestHook,
  readFeedbackQueue,
} from "../../../../olt/scripts/src/mind/feedback/queue/index.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";

describe("Meta Auditor - Invariants, Predicates & Efficiency Score", () => {
  describe("Root Cause Categories & Severities", () => {
    it("exports all 7 canonical root cause categories in expected sequence", () => {
      expect(ROOT_CAUSE_CATEGORIES).toEqual([
        "TOKEN_BURNING",
        "FALSE_SERIALIZATION",
        "ROLE_BOUNDARY_DEVIATION",
        "POLLING_WASTE",
        "CONTEXT_OVERFLOW",
        "GHOST_LEASE",
        "STRAGGLER",
      ]);
      expect(ROOT_CAUSE_CATEGORIES).toHaveLength(7);
    });

    it("exports all 4 standard forensics severity levels in order of precedence", () => {
      expect(FORENSICS_SEVERITIES).toEqual(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
      expect(FORENSICS_SEVERITIES).toHaveLength(4);
    });
  });

  describe("Tool Classification Predicates", () => {
    it("correctly identifies standard and substring read/exploration tools", () => {
      // Known static read tools
      expect(isReadTool("view_file")).toBe(true);
      expect(isReadTool("list_dir")).toBe(true);
      expect(isReadTool("find_by_name")).toBe(true);
      expect(isReadTool("grep_search")).toBe(true);
      expect(isReadTool("read_resource")).toBe(true);
      expect(isReadTool("read_url_content")).toBe(true);
      expect(isReadTool("read_browser_page")).toBe(true);
      expect(isReadTool("list_resources")).toBe(true);
      expect(isReadTool("list_console_messages")).toBe(true);
      expect(isReadTool("list_network_requests")).toBe(true);
      expect(isReadTool("get_console_message")).toBe(true);
      expect(isReadTool("get_network_request")).toBe(true);

      // Substring & MCP prefixed tools
      expect(isReadTool("mcp_server_read_data")).toBe(true);
      expect(isReadTool("mcp_chrome-devtools_list_console_messages")).toBe(true);
      expect(isReadTool("custom_view_action")).toBe(true);
      expect(isReadTool("deep_find_helper")).toBe(true);
      expect(isReadTool("code_grep_query")).toBe(true);

      // Non-read tools
      expect(isReadTool("write_to_file")).toBe(false);
      expect(isReadTool("replace_file_content")).toBe(false);
      expect(isReadTool("run_command")).toBe(false);
      expect(isReadTool("schedule")).toBe(false);
      expect(isReadTool("manage_task")).toBe(false);
    });

    it("correctly identifies standard and substring write/mutation tools", () => {
      // Known static write tools
      expect(isWriteTool("write_to_file")).toBe(true);
      expect(isWriteTool("replace_file_content")).toBe(true);
      expect(isWriteTool("notebook_edit")).toBe(true);
      expect(isWriteTool("generate_image")).toBe(true);
      expect(isWriteTool("edit_file")).toBe(true);

      // Substring & MCP prefixed tools
      expect(isWriteTool("mcp_workspace_write_file")).toBe(true);
      expect(isWriteTool("mcp_notion_edit_file")).toBe(true);
      expect(isWriteTool("custom_replace_block")).toBe(true);

      // Non-write tools
      expect(isWriteTool("view_file")).toBe(false);
      expect(isWriteTool("grep_search")).toBe(false);
      expect(isWriteTool("run_command")).toBe(false);
      expect(isWriteTool("schedule")).toBe(false);
      expect(isWriteTool("manage_task")).toBe(false);
    });

    it("correctly identifies polling and async status management tools", () => {
      // schedule is unconditionally polling
      expect(isPollTool("schedule")).toBe(true);
      expect(isPollTool("mcp_core_schedule")).toBe(true);

      // manage_task without arguments defaults to polling
      expect(isPollTool("manage_task")).toBe(true);

      // manage_task with status / list action
      expect(isPollTool("manage_task", { Action: "status" })).toBe(true);
      expect(isPollTool("manage_task", { Action: "STATUS" })).toBe(true);
      expect(isPollTool("manage_task", { Action: "list" })).toBe(true);
      expect(isPollTool("manage_task", { Action: "LIST" })).toBe(true);

      // manage_task with non-polling action
      expect(isPollTool("manage_task", { Action: "kill" })).toBe(false);
      expect(isPollTool("manage_task", { Action: "send_input" })).toBe(false);

      // Other non-polling tools
      expect(isPollTool("view_file")).toBe(false);
      expect(isPollTool("write_to_file")).toBe(false);
      expect(isPollTool("run_command")).toBe(false);
    });
  });

  describe("Efficiency Score Calculation", () => {
    it("returns 100.0 for clean executions with ideal metrics", () => {
      const score = calculateEfficiencyScore(
        {
          readToWriteRatio: 2.5,
          sequentialWaveBottlenecks: 0,
          pollingCallsCount: 0,
        },
        [],
      );
      expect(score).toBe(100.0);
    });

    it("applies accurate deductions for incident severities", () => {
      const makeInc = (severity: ForensicsSeverity): ForensicsIncident => ({
        id: `inc-${severity.toLowerCase()}`,
        category: "TOKEN_BURNING",
        severity,
        title: `Test ${severity}`,
        description: "Desc",
        observation: "Obs",
        remediation: "Rem",
        recommendation: "Rec",
      });

      // CRITICAL = -25.0
      expect(calculateEfficiencyScore({}, [makeInc("CRITICAL")])).toBe(75.0);

      // HIGH = -15.0
      expect(calculateEfficiencyScore({}, [makeInc("HIGH")])).toBe(85.0);

      // MEDIUM = -8.0
      expect(calculateEfficiencyScore({}, [makeInc("MEDIUM")])).toBe(92.0);

      // LOW = -3.0
      expect(calculateEfficiencyScore({}, [makeInc("LOW")])).toBe(97.0);

      // Combined deductions: 100 - 25 - 15 - 8 - 3 = 49.0
      expect(
        calculateEfficiencyScore({}, [
          makeInc("CRITICAL"),
          makeInc("HIGH"),
          makeInc("MEDIUM"),
          makeInc("LOW"),
        ]),
      ).toBe(49.0);
    });

    it("applies metric-based deductions for exploration ratio, polling, and serialization", () => {
      // readToWriteRatio > 15: penalty Math.min(20, (25 - 15) * 1.5) = 15.0
      const scoreRatio = calculateEfficiencyScore(
        { readToWriteRatio: 25.0, sequentialWaveBottlenecks: 0, pollingCallsCount: 0 },
        [],
      );
      expect(scoreRatio).toBe(85.0);

      // pollingCallsCount > 5: penalty Math.min(15, (10 - 5) * 2.0) = 10.0
      const scorePolling = calculateEfficiencyScore(
        { readToWriteRatio: 1.0, sequentialWaveBottlenecks: 0, pollingCallsCount: 10 },
        [],
      );
      expect(scorePolling).toBe(90.0);

      // sequentialWaveBottlenecks > 0: penalty Math.min(15, 2 * 5.0) = 10.0
      const scoreSeq = calculateEfficiencyScore(
        { readToWriteRatio: 1.0, sequentialWaveBottlenecks: 2, pollingCallsCount: 0 },
        [],
      );
      expect(scoreSeq).toBe(90.0);
    });

    it("clamps efficiency score between 0.0 and 100.0 and rounds to 1 decimal place", () => {
      const makeInc = (id: string, severity: ForensicsSeverity): ForensicsIncident => ({
        id,
        category: "ROLE_BOUNDARY_DEVIATION",
        severity,
        title: "Violation",
        description: "Desc",
        observation: "Obs",
        remediation: "Rem",
        recommendation: "Rec",
      });

      // 5 Critical incidents = -125 => clamped to 0.0
      const scoreFloor = calculateEfficiencyScore(
        { readToWriteRatio: 50, pollingCallsCount: 20, sequentialWaveBottlenecks: 10 },
        [
          makeInc("i1", "CRITICAL"),
          makeInc("i2", "CRITICAL"),
          makeInc("i3", "CRITICAL"),
          makeInc("i4", "CRITICAL"),
          makeInc("i5", "CRITICAL"),
        ],
      );
      expect(scoreFloor).toBe(0.0);

      // Partial decimal rounding check
      const fractionalScore = calculateEfficiencyScore({ readToWriteRatio: 16.333 }, []);
      // (16.333 - 15) * 1.5 = 1.333 * 1.5 = 1.9995 => 100 - 2.0 = 98.0
      expect(fractionalScore).toBeCloseTo(98.0, 1);
    });
  });
});
