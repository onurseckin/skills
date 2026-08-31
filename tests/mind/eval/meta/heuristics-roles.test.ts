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


import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

describe("Meta Auditor - Behavioral Forensics (Roles, Polling, Context)", () => {
    it("detects Heuristic 3: ROLE_BOUNDARY_DEVIATION for coordinator write & validator command execution", () => {
      const scratchDir = mkdtempSync(join(tmpdir(), "meta-scratch-")); mkdirSync(scratchDir, { recursive: true });

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
            arguments: { CommandLine: "bun test tests/ok.test.ts" },
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
      const scratchDir = mkdtempSync(join(tmpdir(), "meta-scratch-")); mkdirSync(scratchDir, { recursive: true });

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
      const scratchDir = mkdtempSync(join(tmpdir(), "meta-scratch-")); mkdirSync(scratchDir, { recursive: true });

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

});
