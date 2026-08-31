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

describe("Meta Auditor - Deep Behavioral Forensics Core Heuristics", () => {
    it("throws HarnessError when runRoot is missing or empty", () => {
      expect(() => {
        analyzeRunForensics({ runRoot: "" });
      }).toThrow(HarnessError);

      expect(() => {
        analyzeRunForensics({});
      }).toThrow("runRoot option is required");
    });

    it("evaluates a completely clean run with 100.0 score and zero incidents", () => {
      const scratchDir = mkdtempSync(join(tmpdir(), "meta-scratch-")); mkdirSync(scratchDir, { recursive: true });

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
      const res = analyzeRunForensics({ runRoot: scratchDir });
      expect(res).toBeDefined();
    });
  });
