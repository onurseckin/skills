import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
} from "../../../olt/scripts/src/mind/meta-auditor.ts";
import {
  formatMetaAuditReport,
  metaAuditCommand,
  renderEfficiencyMetricsTable,
  renderForensicsIncidentTable,
} from "../../../olt/scripts/src/cli/commands/meta-audit.ts";
import type { AgentGrantRecord } from "../../../olt/scripts/src/core/contracts/agents.ts";
import type { Manifest, RunState } from "../../../olt/scripts/src/core/contracts/capsule.ts";
import {
  __setFeedbackQueuePersistenceTestHook,
  readFeedbackQueue,
} from "../../../olt/scripts/src/mind/feedback-queue.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Deep Behavioral Forensics Engine (meta-auditor)", () => {
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

  describe("Remediation Plan Synthesis", () => {
    it("synthesizes proposals for all 7 behavioral root causes", () => {
      const allIncidents: readonly ForensicsIncident[] = [
        {
          id: "inc-tb-1",
          category: "TOKEN_BURNING",
          severity: "HIGH",
          title: "Excessive Reads",
          description: "Read 25 files",
          observation: "Read 25 files before write",
          remediation: "Exact anchors",
          recommendation: "Exact anchors",
          agentId: "agent-tb",
        },
        {
          id: "inc-fs-1",
          category: "FALSE_SERIALIZATION",
          severity: "HIGH",
          title: "Serial Tasks",
          description: "Serial execution of disjoint scopes",
          observation: "Disjoint tasks executed serially",
          remediation: "Wave concurrency",
          recommendation: "Wave concurrency",
        },
        {
          id: "inc-rbd-1",
          category: "ROLE_BOUNDARY_DEVIATION",
          severity: "CRITICAL",
          title: "Coordinator Write",
          description: "Coordinator modified code",
          observation: "Coordinator wrote files",
          remediation: "Supervisory role isolation",
          recommendation: "Supervisory role isolation",
          agentId: "coordinator-alpha",
        },
        {
          id: "inc-pw-1",
          category: "POLLING_WASTE",
          severity: "MEDIUM",
          title: "Status Loops",
          description: "Polled 8 times",
          observation: "Active polling loops",
          remediation: "WaitMsBeforeAsync 10000",
          recommendation: "WaitMsBeforeAsync 10000",
          agentId: "implementer-beta",
        },
        {
          id: "inc-co-1",
          category: "CONTEXT_OVERFLOW",
          severity: "CRITICAL",
          title: "Context Saturation",
          description: "Consumed 190k input tokens",
          observation: "Context window saturation",
          remediation: "Stream chunking",
          recommendation: "Stream chunking",
          agentId: "agent-gamma",
        },
        {
          id: "inc-gl-1",
          category: "GHOST_LEASE",
          severity: "HIGH",
          title: "Abandoned Lease",
          description: "Agent released while task leased",
          observation: "Ghost lease detected",
          remediation: "Reclaim idle leases",
          recommendation: "Reclaim idle leases",
          taskId: "task-ghost-99",
          agentId: "agent-ghost",
        },
        {
          id: "inc-str-1",
          category: "STRAGGLER",
          severity: "MEDIUM",
          title: "Straggler Task",
          description: "Task took 250s (4x avg)",
          observation: "Straggler task bottleneck",
          remediation: "Decompose tasks",
          recommendation: "Decompose tasks",
          taskId: "task-slow-1",
        },
      ];

      const proposals = synthesizeRemediationPlan(allIncidents);
      expect(proposals).toHaveLength(7);

      const byRootCause = new Map<RootCauseCategory, PlanInjectionProposal>();
      for (const prop of proposals) {
        byRootCause.set(prop.rootCause, prop);
      }

      // 1. TOKEN_BURNING
      const tbProp = byRootCause.get("TOKEN_BURNING")!;
      expect(tbProp).toBeDefined();
      expect(tbProp.title).toContain("Exact-Anchor");
      expect(tbProp.priority).toBe("HIGH_ARCHITECTURAL_FEATURE");
      expect(tbProp.category).toBe("CORE_ENGINE");
      expect(tbProp.targetRole).toBe("coordinator");
      expect(tbProp.remediationDirective).toContain("Exact-Anchor");

      // 2. FALSE_SERIALIZATION
      const fsProp = byRootCause.get("FALSE_SERIALIZATION")!;
      expect(fsProp).toBeDefined();
      expect(fsProp.title).toContain("Parallel Wave Concurrency");
      expect(fsProp.priority).toBe("HIGH_ARCHITECTURAL_FEATURE");
      expect(fsProp.category).toBe("SCALING");
      expect(fsProp.targetRole).toBe("coordinator");
      expect(fsProp.remediationDirective).toContain("disjoint write scopes");

      // 3. ROLE_BOUNDARY_DEVIATION
      const rbdProp = byRootCause.get("ROLE_BOUNDARY_DEVIATION")!;
      expect(rbdProp).toBeDefined();
      expect(rbdProp.title).toContain("Role Boundary Guardrails");
      expect(rbdProp.priority).toBe("CRITICAL_USER_FEEDBACK");
      expect(rbdProp.category).toBe("AGENT_CONTRACTS");
      expect(rbdProp.targetRole).toBe("coordinator-alpha");
      expect(rbdProp.remediationDirective).toContain("Prohibit coordinators");

      // 4. POLLING_WASTE
      const pwProp = byRootCause.get("POLLING_WASTE")!;
      expect(pwProp).toBeDefined();
      expect(pwProp.title).toContain("WaitMsBeforeAsync: 10000");
      expect(pwProp.priority).toBe("HIGH_ARCHITECTURAL_FEATURE");
      expect(pwProp.category).toBe("CLI_TOOLING");
      expect(pwProp.targetRole).toBe("implementer");
      expect(pwProp.remediationDirective).toContain("WaitMsBeforeAsync: 10000");

      // 5. CONTEXT_OVERFLOW
      const coProp = byRootCause.get("CONTEXT_OVERFLOW")!;
      expect(coProp).toBeDefined();
      expect(coProp.title).toContain("Stream Chunking");
      expect(coProp.priority).toBe("HIGH_ARCHITECTURAL_FEATURE");
      expect(coProp.category).toBe("CORE_ENGINE");
      expect(coProp.targetRole).toBe("orchestrator");
      expect(coProp.remediationDirective).toContain("Cowan-chunked context limits");

      // 6. GHOST_LEASE
      const glProp = byRootCause.get("GHOST_LEASE")!;
      expect(glProp).toBeDefined();
      expect(glProp.title).toContain("Automatic Lease Expiration");
      expect(glProp.priority).toBe("NORMAL");
      expect(glProp.category).toBe("WATCHDOG");
      expect(glProp.targetRole).toBe("watchdog");
      expect(glProp.remediationDirective).toContain("Reclaim task leases");

      // 7. STRAGGLER
      const strProp = byRootCause.get("STRAGGLER")!;
      expect(strProp).toBeDefined();
      expect(strProp.title).toContain("Granular Task Decomposition");
      expect(strProp.priority).toBe("NORMAL");
      expect(strProp.category).toBe("ARCHITECTURE");
      expect(strProp.targetRole).toBe("orchestrator");
      expect(strProp.remediationDirective).toContain("Decompose complex requirements");
    });

    it("deduplicates multiple incidents of the same root cause category", () => {
      const duplicateIncidents: readonly ForensicsIncident[] = [
        {
          id: "inc-1",
          category: "TOKEN_BURNING",
          severity: "HIGH",
          title: "Token Burn 1",
          description: "Desc 1",
          observation: "Obs 1",
          remediation: "Rem 1",
          recommendation: "Rec 1",
        },
        {
          id: "inc-2",
          category: "TOKEN_BURNING",
          severity: "CRITICAL",
          title: "Token Burn 2",
          description: "Desc 2",
          observation: "Obs 2",
          remediation: "Rem 2",
          recommendation: "Rec 2",
        },
      ];

      const proposals = synthesizeRemediationPlan(duplicateIncidents);
      expect(proposals).toHaveLength(1);
      expect(proposals[0]?.rootCause).toBe("TOKEN_BURNING");
    });
  });

  describe("Feedback Queue Remediation Injection", () => {
    it("returns zero counts when empty proposals/incidents provided", () => {
      const result = injectRemediationToFeedbackQueue([]);
      expect(result.injectedCount).toBe(0);
      expect(result.injected_count).toBe(0);
      expect(result.itemIds).toEqual([]);
      expect(result.injected_items).toEqual([]);
    });

    it("injects synthesized proposals into feedback queue and skips duplicate titles", () => {
      const scratchDir = scratchRoot(import.meta.path, "test-feedback-injection");
      const queuePath = join(scratchDir, "FEEDBACK_QUEUE.jsonl");

      const incident: ForensicsIncident = {
        id: "inc-co-test",
        category: "CONTEXT_OVERFLOW",
        severity: "HIGH",
        title: "Test Context Overflow",
        description: "Agent token budget exceeded",
        observation: "Agent token budget exceeded",
        remediation: "Apply chunking",
        recommendation: "Apply chunking",
        agentId: "agent-1",
      };

      const injectionOptions: FeedbackInjectionOptions = {
        queue_path: queuePath,
      };

      // 1. First injection: should inject 1 proposal
      const res1 = injectRemediationToFeedbackQueue([incident], injectionOptions);
      expect(res1.injectedCount).toBe(1);
      expect(res1.itemIds).toHaveLength(1);
      expect(existsSync(queuePath)).toBe(true);

      const itemsInQueue = readFeedbackQueue(queuePath);
      expect(itemsInQueue).toHaveLength(1);
      expect(itemsInQueue[0]?.title).toContain("Stream Chunking");
      expect(itemsInQueue[0]?.status).toBe("PENDING");
      expect(itemsInQueue[0]?.category).toBe("CORE_ENGINE");

      // 2. Second injection with same incident: should detect duplicate title and skip
      const res2 = injectRemediationToFeedbackQueue([incident], injectionOptions);
      expect(res2.injectedCount).toBe(0);
      expect(res2.itemIds).toHaveLength(0);

      const itemsAfterSecond = readFeedbackQueue(queuePath);
      expect(itemsAfterSecond).toHaveLength(1);
    });

    it("supports passing string run root or customRoot options", () => {
      const scratchDir = scratchRoot(import.meta.path, "test-root-options");
      const subQueueDir = join(scratchDir, ".olt");
      mkdirSync(subQueueDir, { recursive: true });

      const incident: ForensicsIncident = {
        id: "inc-tb-test",
        category: "TOKEN_BURNING",
        severity: "HIGH",
        title: "Token Burn Test",
        description: "Test",
        observation: "Test",
        remediation: "Test",
        recommendation: "Test",
      };

      const result = injectRemediationToFeedbackQueue([incident], scratchDir);
      expect(result.injectedCount).toBe(1);
      expect(result.queue_path).toBeDefined();
    });

    it("does not fallback-count a remediation injection when persistence fails", () => {
      const scratchDir = scratchRoot(import.meta.path, "test-injection-persistence-failure");
      const queuePath = join(scratchDir, "FEEDBACK_QUEUE.jsonl");
      const incident: ForensicsIncident = {
        id: "inc-persist-failure",
        category: "TOKEN_BURNING",
        severity: "HIGH",
        title: "Persistence Failure",
        description: "Test",
        observation: "Test",
        remediation: "Test",
        recommendation: "Test",
      };
      __setFeedbackQueuePersistenceTestHook((stage) => {
        if (stage === "before_rename") throw new Error("forced persistence failure");
      });
      try {
        expect(() =>
          injectRemediationToFeedbackQueue([incident], { queue_path: queuePath }),
        ).toThrow("forced persistence failure");
        expect(existsSync(queuePath)).toBe(false);
      } finally {
        __setFeedbackQueuePersistenceTestHook(undefined);
      }
    });

    it("keeps one record when synchronized meta-audit injections share a title", async () => {
      const scratchDir = scratchRoot(import.meta.path, "test-concurrent-meta-dedupe");
      const queuePath = join(scratchDir, "FEEDBACK_QUEUE.jsonl");
      const latch = join(scratchDir, "inject-go");
      mkdirSync(scratchDir, { recursive: true });
      const modulePath = join(process.cwd(), "olt/scripts/src/mind/meta-auditor.ts");
      const child = () =>
        Bun.spawn({
          cmd: [
            "bun",
            "-e",
            `import { injectRemediationToFeedbackQueue } from ${JSON.stringify(modulePath)}; import { existsSync } from "node:fs"; const [queue, latch] = process.argv.slice(-2); while (!existsSync(latch)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1); injectRemediationToFeedbackQueue([{ id: "prop-shared", title: "Shared dedupe title", content: "content", priority: "NORMAL", category: "GENERAL", rootCause: "TOKEN_BURNING", remediationDirective: "directive" }], { queue_path: queue });`,
            queuePath,
            latch,
          ],
          stdout: "pipe",
          stderr: "pipe",
        });
      const first = child();
      const second = child();
      writeFileSync(latch, "go", "utf8");
      expect(await first.exited).toBe(0);
      expect(await second.exited).toBe(0);
      expect(readFeedbackQueue(queuePath)).toHaveLength(1);
    });
  });

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

  describe("analyzeRunForensics Deep Behavioral Heuristics", () => {
    it("throws HarnessError when runRoot is missing or empty", () => {
      expect(() => {
        analyzeRunForensics({ runRoot: "" });
      }).toThrow(HarnessError);

      expect(() => {
        analyzeRunForensics({});
      }).toThrow("runRoot option is required");
    });

    it("evaluates a completely clean run with 100.0 score and zero incidents", () => {
      const scratchDir = scratchRoot(import.meta.path, "test-clean-run");

      const manifest: Manifest = {
        version: "2.0.0",
        run_id: "run-clean-test",
        created_at: "2026-08-23T00:00:00.000Z",
        entry_task_id: "task-1",
      };
      writeFileSync(join(scratchDir, "manifest.json"), JSON.stringify(manifest, null, 2));

      const state: RunState = {
        version: "2.0.0",
        run_id: "run-clean-test",
        created_at: "2026-08-23T00:00:00.000Z",
        updated_at: "2026-08-23T00:01:00.000Z",
        status: "succeeded",
        tasks: {
          "task-1": {
            id: "task-1",
            title: "Task 1",
            description: "Do task 1",
            status: "succeeded",
            kind: "implementation",
            write_scope: ["src/file1.ts"],
            attempts: [
              {
                attempt: 1,
                status: "succeeded",
                agent_id: "implementer_1",
                started_at: "2026-08-23T00:00:10.000Z",
                completed_at: "2026-08-23T00:00:30.000Z",
              },
            ],
          },
        },
        agents: [
          {
            id: "implementer_1",
            role: "implementer",
            status: "released",
            tokens_in: 2500,
            tokens_out: 800,
          },
        ],
      };
      writeFileSync(join(scratchDir, "state.json"), JSON.stringify(state, null, 2));

      // Clean events: minimal reads and direct writes, no polling
      const events = [
        {
          sequence: 1,
          kind: "tool-called",
          actor: "implementer_1",
          timestamp: "2026-08-23T00:00:15.000Z",
          payload: {
            tool: "view_file",
            arguments: { AbsolutePath: "/src/file1.ts" },
          },
        },
        {
          sequence: 2,
          kind: "tool-called",
          actor: "implementer_1",
          timestamp: "2026-08-23T00:00:20.000Z",
          payload: {
            tool: "write_to_file",
            arguments: { TargetFile: "/src/file1.ts" },
          },
        },
      ];
      writeFileSync(
        join(scratchDir, "events.jsonl"),
        events.map((e) => JSON.stringify(e)).join("\n") + "\n",
      );

      const result = analyzeRunForensics({ runRoot: scratchDir });
      expect(result.runId).toBe("run-clean-test");
      expect(result.isClean).toBe(true);
      expect(result.efficiencyScore).toBe(100.0);
      expect(result.incidents).toHaveLength(0);
      expect(result.proposals).toHaveLength(0);
    });

    it("detects Heuristic 1: TOKEN_BURNING from excessive reads before write and global ratio", () => {
      const scratchDir = scratchRoot(import.meta.path, "test-heuristic-token-burning");

      const manifest: Manifest = {
        version: "2.0.0",
        run_id: "run-tb-test",
        created_at: "2026-08-23T00:00:00.000Z",
        entry_task_id: "task-1",
      };
      writeFileSync(join(scratchDir, "manifest.json"), JSON.stringify(manifest, null, 2));

      const state: RunState = {
        version: "2.0.0",
        run_id: "run-tb-test",
        created_at: "2026-08-23T00:00:00.000Z",
        updated_at: "2026-08-23T00:05:00.000Z",
        status: "succeeded",
        tasks: {},
        agents: [
          {
            id: "implementer_tb",
            role: "implementer",
            status: "released",
            tokens_in: 5000,
            tokens_out: 1000,
          },
        ],
      };
      writeFileSync(join(scratchDir, "state.json"), JSON.stringify(state, null, 2));

      // 16 read calls followed by 1 write call
      const events: Array<{
        sequence: number;
        kind: string;
        actor: string;
        timestamp: string;
        payload: Record<string, unknown>;
      }> = [];
      for (let i = 1; i <= 16; i++) {
        events.push({
          sequence: i,
          kind: "tool-called",
          actor: "implementer_tb",
          timestamp: `2026-08-23T00:01:${String(i).padStart(2, "0")}.000Z`,
          payload: {
            tool: "view_file",
            arguments: { AbsolutePath: `/src/file${i}.ts` },
          },
        });
      }
      events.push({
        sequence: 17,
        kind: "tool-called",
        actor: "implementer_tb",
        timestamp: "2026-08-23T00:01:30.000Z",
        payload: {
          tool: "write_to_file",
          arguments: { TargetFile: "/src/file1.ts" },
        },
      });

      writeFileSync(
        join(scratchDir, "events.jsonl"),
        events.map((e) => JSON.stringify(e)).join("\n") + "\n",
      );

      const result = analyzeRunForensics({ runRoot: scratchDir });
      expect(result.isClean).toBe(false);

      const tbIncidents = result.incidents.filter((i) => i.category === "TOKEN_BURNING");
      expect(tbIncidents.length).toBeGreaterThanOrEqual(1);

      const agentTbIncident = tbIncidents.find((i) => i.agentId === "implementer_tb");
      expect(agentTbIncident).toBeDefined();
      expect(agentTbIncident?.severity).toBe("CRITICAL"); // > 12 reads = CRITICAL

      expect(result.proposals.some((p) => p.rootCause === "TOKEN_BURNING")).toBe(true);
    });

    it("detects Heuristic 2: FALSE_SERIALIZATION when disjoint tasks execute sequentially", () => {
      const scratchDir = scratchRoot(import.meta.path, "test-heuristic-false-serialization");

      const manifest: Manifest = {
        version: "2.0.0",
        run_id: "run-fs-test",
        created_at: "2026-08-23T00:00:00.000Z",
        entry_task_id: "task-1",
      };
      writeFileSync(join(scratchDir, "manifest.json"), JSON.stringify(manifest, null, 2));

      // 3 tasks with disjoint write scopes running in serial sequence
      const state: RunState = {
        version: "2.0.0",
        run_id: "run-fs-test",
        created_at: "2026-08-23T00:00:00.000Z",
        updated_at: "2026-08-23T00:05:00.000Z",
        status: "succeeded",
        tasks: {
          "task-1": {
            id: "task-1",
            title: "Task 1",
            description: "Task 1",
            status: "succeeded",
            kind: "implementation",
            write_scope: ["src/a.ts"],
            attempts: [
              {
                attempt: 1,
                status: "succeeded",
                agent_id: "agent-1",
                started_at: "2026-08-23T00:01:00.000Z",
                completed_at: "2026-08-23T00:02:00.000Z",
              },
            ],
          },
          "task-2": {
            id: "task-2",
            title: "Task 2",
            description: "Task 2",
            status: "succeeded",
            kind: "implementation",
            write_scope: ["src/b.ts"],
            attempts: [
              {
                attempt: 1,
                status: "succeeded",
                agent_id: "agent-2",
                started_at: "2026-08-23T00:02:05.000Z",
                completed_at: "2026-08-23T00:03:00.000Z",
              },
            ],
          },
          "task-3": {
            id: "task-3",
            title: "Task 3",
            description: "Task 3",
            status: "succeeded",
            kind: "implementation",
            write_scope: ["src/c.ts"],
            attempts: [
              {
                attempt: 1,
                status: "succeeded",
                agent_id: "agent-3",
                started_at: "2026-08-23T00:03:05.000Z",
                completed_at: "2026-08-23T00:04:00.000Z",
              },
            ],
          },
        },
        agents: [],
      };
      writeFileSync(join(scratchDir, "state.json"), JSON.stringify(state, null, 2));
      writeFileSync(join(scratchDir, "events.jsonl"), "");

      const result = analyzeRunForensics({ runRoot: scratchDir });
      const fsIncident = result.incidents.find((i) => i.category === "FALSE_SERIALIZATION");
      expect(fsIncident).toBeDefined();
      expect(fsIncident?.severity).toBe("MEDIUM");
      expect(result.metrics.sequentialWaveBottlenecks).toBe(2);
    });

    it("detects Heuristic 3: ROLE_BOUNDARY_DEVIATION for coordinator write & validator command execution", () => {
      const scratchDir = scratchRoot(import.meta.path, "test-heuristic-role-boundary");

      const manifest: Manifest = {
        version: "2.0.0",
        run_id: "run-rbd-test",
        created_at: "2026-08-23T00:00:00.000Z",
        entry_task_id: "task-1",
      };
      writeFileSync(join(scratchDir, "manifest.json"), JSON.stringify(manifest, null, 2));

      const state: RunState = {
        version: "2.0.0",
        run_id: "run-rbd-test",
        created_at: "2026-08-23T00:00:00.000Z",
        updated_at: "2026-08-23T00:05:00.000Z",
        status: "succeeded",
        tasks: {},
        agents: [],
      };
      writeFileSync(join(scratchDir, "state.json"), JSON.stringify(state, null, 2));

      const events = [
        // Coordinator performing write
        {
          sequence: 1,
          kind: "tool-called",
          actor: "coordinator-lead",
          timestamp: "2026-08-23T00:01:00.000Z",
          payload: {
            tool: "write_to_file",
            arguments: { TargetFile: "/src/forbidden.ts" },
          },
        },
        // Validator executing arbitrary bash command without test
        {
          sequence: 2,
          kind: "tool-called",
          actor: "validator-qa",
          timestamp: "2026-08-23T00:02:00.000Z",
          payload: {
            tool: "run_command",
            arguments: { CommandLine: "rm -rf /tmp/something" },
          },
        },
        // Validator executing legitimate test command (should NOT trigger deviation)
        {
          sequence: 3,
          kind: "tool-called",
          actor: "validator-qa",
          timestamp: "2026-08-23T00:03:00.000Z",
          payload: {
            tool: "run_command",
            arguments: { CommandLine: "bun test tests/unit/ok.test.ts" },
          },
        },
      ];
      writeFileSync(
        join(scratchDir, "events.jsonl"),
        events.map((e) => JSON.stringify(e)).join("\n") + "\n",
      );

      const result = analyzeRunForensics({ runRoot: scratchDir });
      const rbdIncidents = result.incidents.filter((i) => i.category === "ROLE_BOUNDARY_DEVIATION");
      expect(rbdIncidents).toHaveLength(2);

      const coordInc = rbdIncidents.find((i) => i.agentId === "coordinator-lead");
      expect(coordInc).toBeDefined();
      expect(coordInc?.severity).toBe("CRITICAL");

      const valInc = rbdIncidents.find((i) => i.agentId === "validator-qa");
      expect(valInc).toBeDefined();
      expect(valInc?.severity).toBe("HIGH");
    });

    it("detects Heuristic 4: POLLING_WASTE from high-frequency polling calls and polled events", () => {
      const scratchDir = scratchRoot(import.meta.path, "test-heuristic-polling-waste");

      const manifest: Manifest = {
        version: "2.0.0",
        run_id: "run-pw-test",
        created_at: "2026-08-23T00:00:00.000Z",
        entry_task_id: "task-1",
      };
      writeFileSync(join(scratchDir, "manifest.json"), JSON.stringify(manifest, null, 2));

      const state: RunState = {
        version: "2.0.0",
        run_id: "run-pw-test",
        created_at: "2026-08-23T00:00:00.000Z",
        updated_at: "2026-08-23T00:05:00.000Z",
        status: "succeeded",
        tasks: {},
        agents: [],
      };
      writeFileSync(join(scratchDir, "state.json"), JSON.stringify(state, null, 2));

      // 5 polling tool calls
      const events: Array<{
        sequence: number;
        kind: string;
        actor: string;
        timestamp: string;
        payload: Record<string, unknown>;
      }> = [];
      for (let i = 1; i <= 5; i++) {
        events.push({
          sequence: i,
          kind: "tool-called",
          actor: "agent-loop",
          timestamp: `2026-08-23T00:01:0${i}.000Z`,
          payload: {
            tool: "manage_task",
            arguments: { Action: "status", TaskId: "t-1" },
          },
        });
      }

      writeFileSync(
        join(scratchDir, "events.jsonl"),
        events.map((e) => JSON.stringify(e)).join("\n") + "\n",
      );

      const result = analyzeRunForensics({ runRoot: scratchDir });
      const pwInc = result.incidents.find((i) => i.category === "POLLING_WASTE");
      expect(pwInc).toBeDefined();
      expect(pwInc?.severity).toBe("MEDIUM");
      expect(result.metrics.pollingCallsCount).toBe(5);
    });

    it("detects Heuristic 5: CONTEXT_OVERFLOW when agent token count exceeds threshold", () => {
      const scratchDir = scratchRoot(import.meta.path, "test-heuristic-context-overflow");

      const manifest: Manifest = {
        version: "2.0.0",
        run_id: "run-co-test",
        created_at: "2026-08-23T00:00:00.000Z",
        entry_task_id: "task-1",
      };
      writeFileSync(join(scratchDir, "manifest.json"), JSON.stringify(manifest, null, 2));

      const state: RunState = {
        version: "2.0.0",
        run_id: "run-co-test",
        created_at: "2026-08-23T00:00:00.000Z",
        updated_at: "2026-08-23T00:05:00.000Z",
        status: "succeeded",
        tasks: {},
        agents: [
          {
            id: "agent-heavy",
            role: "implementer",
            status: "released",
            tokens_in: 195000,
            tokens_out: 4000,
          },
        ],
      };
      writeFileSync(join(scratchDir, "state.json"), JSON.stringify(state, null, 2));
      writeFileSync(join(scratchDir, "events.jsonl"), "");

      const result = analyzeRunForensics({ runRoot: scratchDir });
      const coInc = result.incidents.find((i) => i.category === "CONTEXT_OVERFLOW");
      expect(coInc).toBeDefined();
      expect(coInc?.severity).toBe("CRITICAL"); // > 180,000 = CRITICAL
      expect(coInc?.agentId).toBe("agent-heavy");
    });

    it("detects Heuristic 6: GHOST_LEASE when task remains leased to a released agent", () => {
      const scratchDir = scratchRoot(import.meta.path, "test-heuristic-ghost-lease");

      const manifest: Manifest = {
        version: "2.0.0",
        run_id: "run-gl-test",
        created_at: "2026-08-23T00:00:00.000Z",
        entry_task_id: "task-ghost",
      };
      writeFileSync(join(scratchDir, "manifest.json"), JSON.stringify(manifest, null, 2));

      const state: RunState = {
        version: "2.0.0",
        run_id: "run-gl-test",
        created_at: "2026-08-23T00:00:00.000Z",
        updated_at: "2026-08-23T00:05:00.000Z",
        status: "active",
        tasks: {
          "task-ghost": {
            id: "task-ghost",
            title: "Orphaned Task",
            description: "Desc",
            status: "leased",
            kind: "implementation",
            write_scope: ["src/ghost.ts"],
            lease: {
              agent_id: "agent-departed",
              lease_token: "tok-123",
              expires_at: "2026-08-23T00:10:00.000Z",
            },
          },
        },
        agents: [
          {
            id: "agent-departed",
            role: "implementer",
            status: "released",
            tokens_in: 1000,
            tokens_out: 200,
          },
        ],
      };
      writeFileSync(join(scratchDir, "state.json"), JSON.stringify(state, null, 2));
      writeFileSync(join(scratchDir, "events.jsonl"), "");

      const result = analyzeRunForensics({ runRoot: scratchDir });
      const glInc = result.incidents.find((i) => i.category === "GHOST_LEASE");
      expect(glInc).toBeDefined();
      expect(glInc?.severity).toBe("HIGH");
      expect(glInc?.taskId).toBe("task-ghost");
      expect(glInc?.agentId).toBe("agent-departed");
    });

    it("detects Heuristic 7: STRAGGLER tasks that dominate execution wall-clock time", () => {
      const scratchDir = scratchRoot(import.meta.path, "test-heuristic-straggler");

      const manifest: Manifest = {
        version: "2.0.0",
        run_id: "run-str-test",
        created_at: "2026-08-23T00:00:00.000Z",
        entry_task_id: "task-1",
      };
      writeFileSync(join(scratchDir, "manifest.json"), JSON.stringify(manifest, null, 2));

      // 4 tasks: three 10s tasks and one 200s task (total 230s, avg 57.5s, 3x avg = 172.5s < 200s, 200s > 120s)
      const state: RunState = {
        version: "2.0.0",
        run_id: "run-str-test",
        created_at: "2026-08-23T00:00:00.000Z",
        updated_at: "2026-08-23T00:10:00.000Z",
        status: "succeeded",
        tasks: {
          "task-fast-1": {
            id: "task-fast-1",
            title: "Fast 1",
            description: "Fast 1",
            status: "succeeded",
            kind: "implementation",
            write_scope: ["src/1.ts"],
            attempts: [
              {
                attempt: 1,
                status: "succeeded",
                started_at: "2026-08-23T00:00:00.000Z",
                completed_at: "2026-08-23T00:00:10.000Z", // 10s
              },
            ],
          },
          "task-fast-2": {
            id: "task-fast-2",
            title: "Fast 2",
            description: "Fast 2",
            status: "succeeded",
            kind: "implementation",
            write_scope: ["src/2.ts"],
            attempts: [
              {
                attempt: 1,
                status: "succeeded",
                started_at: "2026-08-23T00:00:15.000Z",
                completed_at: "2026-08-23T00:00:25.000Z", // 10s
              },
            ],
          },
          "task-fast-3": {
            id: "task-fast-3",
            title: "Fast 3",
            description: "Fast 3",
            status: "succeeded",
            kind: "implementation",
            write_scope: ["src/3.ts"],
            attempts: [
              {
                attempt: 1,
                status: "succeeded",
                started_at: "2026-08-23T00:00:30.000Z",
                completed_at: "2026-08-23T00:00:40.000Z", // 10s
              },
            ],
          },
          "task-slow-1": {
            id: "task-slow-1",
            title: "Slow Straggler",
            description: "Slow Straggler",
            status: "succeeded",
            kind: "implementation",
            write_scope: ["src/4.ts"],
            attempts: [
              {
                attempt: 1,
                status: "succeeded",
                started_at: "2026-08-23T00:01:00.000Z",
                completed_at: "2026-08-23T00:04:20.000Z", // 200s
              },
            ],
          },
        },
        agents: [],
      };
      writeFileSync(join(scratchDir, "state.json"), JSON.stringify(state, null, 2));
      writeFileSync(join(scratchDir, "events.jsonl"), "");

      const result = analyzeRunForensics({ runRoot: scratchDir });
      const strInc = result.incidents.find((i) => i.category === "STRAGGLER");
      expect(strInc).toBeDefined();
      expect(strInc?.taskId).toBe("task-slow-1");
      expect(strInc?.severity).toBe("MEDIUM");
    });

    it("filters analysis by agent filter option", () => {
      const scratchDir = scratchRoot(import.meta.path, "test-agent-filter");

      const manifest: Manifest = {
        version: "2.0.0",
        run_id: "run-filter-test",
        created_at: "2026-08-23T00:00:00.000Z",
        entry_task_id: "task-1",
      };
      writeFileSync(join(scratchDir, "manifest.json"), JSON.stringify(manifest, null, 2));

      const state: RunState = {
        version: "2.0.0",
        run_id: "run-filter-test",
        created_at: "2026-08-23T00:00:00.000Z",
        updated_at: "2026-08-23T00:05:00.000Z",
        status: "succeeded",
        tasks: {},
        agents: [
          {
            id: "agent-a",
            role: "implementer",
            status: "released",
            tokens_in: 200000, // Would trigger context overflow if included
            tokens_out: 1000,
          },
          {
            id: "agent-b",
            role: "implementer",
            status: "released",
            tokens_in: 5000,
            tokens_out: 1000,
          },
        ],
      };
      writeFileSync(join(scratchDir, "state.json"), JSON.stringify(state, null, 2));
      writeFileSync(join(scratchDir, "events.jsonl"), "");

      // Filter only agent-b (clean)
      const resultB = analyzeRunForensics({
        runRoot: scratchDir,
        agent: "agent-b",
      });

      expect(resultB.agent_filter).toBe("agent-b");
      expect(resultB.metrics.totalAgents).toBe(1);
      expect(resultB.incidents).toHaveLength(0);
      expect(resultB.isClean).toBe(true);
    });

    it("parses transcripts in JSON format and regex log format", () => {
      const scratchDir = scratchRoot(import.meta.path, "test-transcripts-parsing");

      const manifest: Manifest = {
        version: "2.0.0",
        run_id: "run-tx-test",
        created_at: "2026-08-23T00:00:00.000Z",
        entry_task_id: "task-1",
      };
      writeFileSync(join(scratchDir, "manifest.json"), JSON.stringify(manifest, null, 2));
      writeFileSync(
        join(scratchDir, "state.json"),
        JSON.stringify({ version: "2.0.0", run_id: "run-tx-test", tasks: {}, agents: [] }),
      );
      writeFileSync(join(scratchDir, "events.jsonl"), "");

      // Create transcript files
      const jsonTranscriptPath = join(scratchDir, "transcript1.json");
      writeFileSync(
        jsonTranscriptPath,
        JSON.stringify([
          {
            tool: "view_file",
            agent_id: "agent-json",
            arguments: { AbsolutePath: "/src/foo.ts" },
          },
          {
            tool: "write_to_file",
            agent_id: "agent-json",
            arguments: { TargetFile: "/src/foo.ts" },
          },
        ]),
      );

      const regexTranscriptPath = join(scratchDir, "transcript2.log");
      writeFileSync(
        regexTranscriptPath,
        `
        call: default_api:grep_search
        Tool Use: replace_file_content
        "toolAction": "list_dir"
        `,
      );

      const result = analyzeRunForensics({
        runRoot: scratchDir,
        transcripts: [jsonTranscriptPath, regexTranscriptPath],
      });

      expect(result.metrics.totalToolCalls).toBe(5);
      expect(result.metrics.fileReadCount).toBe(3); // view_file, grep_search, list_dir
      expect(result.metrics.fileWriteCount).toBe(2); // write_to_file, replace_file_content
    });

    it("accepts custom agentLedger passed in analysis options", () => {
      const scratchDir = scratchRoot(import.meta.path, "test-custom-agent-ledger");

      const customLedger: readonly AgentGrantRecord[] = [
        {
          id: "custom-agent-1",
          role: "implementer",
          status: "released",
          tokens_in: 190000,
          tokens_out: 2000,
        },
      ];

      const options: AnalyzeRunForensicsOptions = {
        run: scratchDir,
        agentLedger: customLedger,
      };

      const result = analyzeRunForensics(options);
      expect(result.metrics.totalAgents).toBe(1);
      expect(result.incidents.some((i) => i.category === "CONTEXT_OVERFLOW")).toBe(true);
    });
  });

  describe("CLI Command metaAuditCommand", () => {
    it("executes metaAuditCommand with markdown format", async () => {
      const scratchDir = scratchRoot(import.meta.path, "test-cli-markdown");

      const manifest: Manifest = {
        version: "2.0.0",
        run_id: "run-cli-md",
        created_at: "2026-08-23T00:00:00.000Z",
        entry_task_id: "task-1",
      };
      writeFileSync(join(scratchDir, "manifest.json"), JSON.stringify(manifest, null, 2));
      writeFileSync(
        join(scratchDir, "state.json"),
        JSON.stringify({ version: "2.0.0", run_id: "run-cli-md", tasks: {}, agents: [] }),
      );
      writeFileSync(join(scratchDir, "events.jsonl"), "");

      const result = await metaAuditCommand({
        run: scratchDir,
        format: "markdown",
      });

      expect(result.format).toBe("markdown");
      expect(result.markdown).toContain("Meta-Auditor Deep Behavioral Forensics Report");
      expect(result.markdown).toContain(scratchDir);
      expect(result.report).toBeDefined();
      expect(result.report.runId).toBe("run-cli-md");
    });

    it("executes metaAuditCommand with json format", async () => {
      const scratchDir = scratchRoot(import.meta.path, "test-cli-json");

      const manifest: Manifest = {
        version: "2.0.0",
        run_id: "run-cli-json",
        created_at: "2026-08-23T00:00:00.000Z",
        entry_task_id: "task-1",
      };
      writeFileSync(join(scratchDir, "manifest.json"), JSON.stringify(manifest, null, 2));
      writeFileSync(
        join(scratchDir, "state.json"),
        JSON.stringify({ version: "2.0.0", run_id: "run-cli-json", tasks: {}, agents: [] }),
      );
      writeFileSync(join(scratchDir, "events.jsonl"), "");

      const result = await metaAuditCommand({
        run: scratchDir,
        json: true,
      });

      expect(result.format).toBe("json");
      expect(result.report).toBeDefined();
      expect(result.report.runId).toBe("run-cli-json");
    });

    it("throws HarnessError on invalid format flag", async () => {
      expect(
        metaAuditCommand({
          run: "/tmp/fake-capsule",
          format: "invalid-fmt",
        }),
      ).rejects.toThrow("invalid --format 'invalid-fmt'");
    });

    it("executes metaAuditCommand with --inject flag to autonomously enqueue remediations", async () => {
      const scratchDir = scratchRoot(import.meta.path, "test-cli-inject");
      const queueDir = join(scratchDir, ".olt");
      mkdirSync(queueDir, { recursive: true });

      const manifest: Manifest = {
        version: "2.0.0",
        run_id: "run-cli-inject",
        created_at: "2026-08-23T00:00:00.000Z",
        entry_task_id: "task-1",
      };
      writeFileSync(join(scratchDir, "manifest.json"), JSON.stringify(manifest, null, 2));

      // Add high tokens agent to trigger Context Overflow
      const state: RunState = {
        version: "2.0.0",
        run_id: "run-cli-inject",
        tasks: {},
        agents: [
          {
            id: "agent-inject-test",
            role: "implementer",
            status: "released",
            tokens_in: 190000,
            tokens_out: 2000,
          },
        ],
      };
      writeFileSync(join(scratchDir, "state.json"), JSON.stringify(state, null, 2));
      writeFileSync(join(scratchDir, "events.jsonl"), "");

      const result = await metaAuditCommand({
        run: scratchDir,
        inject: true,
        verbose: true,
      });

      expect(result.injection).toBeDefined();
      expect(result.injection?.injectedCount).toBeGreaterThan(0);
      expect(result.markdown).toContain("Feedback Queue Injection Status");
      expect(result.markdown).toContain("Injected 1 remediation task(s)");
    });

    it("renders tables and detailed incident views correctly", () => {
      const metricsTable = renderEfficiencyMetricsTable({
        total_events_analyzed: 42,
        total_tool_calls: 18,
        exploration_reads_count: 10,
        polling_calls_count: 3,
        concurrency_bottlenecks_detected: 1,
        role_boundary_deviations: 0,
        total_token_waste_estimate: 8000,
        efficiency_score: 88,
      });

      expect(metricsTable.join("\n")).toContain("Total Events Analyzed");
      expect(metricsTable.join("\n")).toContain("42");
      expect(metricsTable.join("\n")).toContain("88%");

      const incidentTable = renderForensicsIncidentTable([
        {
          id: "inc-pipe|test",
          category: "TOKEN_BURNING",
          severity: "HIGH",
          title: "Pipe | in title",
          description: "Desc",
          observation: "Obs with | pipe",
          remediation: "Rem with | pipe",
          recommendation: "Rec",
          agent_id: "agent|pipe",
        },
      ]);

      expect(incidentTable.join("\n")).toContain("`inc-pipe|test`");
      expect(incidentTable.join("\n")).toContain("HIGH");
      // Verify pipe escaping in observation and remediation
      expect(incidentTable.join("\n")).toContain("Obs with \\| pipe");
    });
  });

  describe("Static Invariant Verification", () => {
    it("verifies meta-auditor.ts, meta-audit.ts, and test suite have 0 any types and 0 compiler suppressions", () => {
      const filesToAudit = [
        resolve(import.meta.dir, "../../../olt/scripts/src/mind/meta-auditor.ts"),
        resolve(import.meta.dir, "../../../olt/scripts/src/cli/commands/meta-audit.ts"),
        resolve(import.meta.dir, "../../../tests/unit/mind/meta-auditor.test.ts"),
      ];

      const anyRegex = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>");
      const suppressionsRegex = new RegExp(
        [
          "@ts" + "-ignore",
          "@ts" + "-expect-error",
          "@ts" + "-nocheck",
          "eslint" + "-disable",
          "oxlint" + "-disable",
        ].join("|"),
      );

      for (const filePath of filesToAudit) {
        if (!existsSync(filePath)) continue;
        const content = readFileSync(filePath, "utf8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (line.includes("anyRegex") || line.includes("suppressionsRegex")) {
            continue;
          }

          expect(anyRegex.test(line)).toBe(false);
          expect(suppressionsRegex.test(line)).toBe(false);
        }
      }
    });
  });
});
