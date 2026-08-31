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

describe("Meta Auditor - Behavioral Forensics (Ghost Leases & Stragglers)", () => {
    it("detects Heuristic 6: GHOST_LEASE when task remains leased to a released agent", () => {
      const scratchDir = mkdtempSync(join(tmpdir(), "meta-scratch-")); mkdirSync(scratchDir, { recursive: true });

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
      const scratchDir = mkdtempSync(join(tmpdir(), "meta-scratch-")); mkdirSync(scratchDir, { recursive: true });

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

});
