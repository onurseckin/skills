import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { setupVirtualMindFS, cleanupVirtualMindFS, scratchRoot } from "../../fixtures/index.ts";
import {
  computeStateSignature,
  compareReportDelta,
} from "../../../../olt/scripts/src/mind/auditing/stagnation-delta.ts";
import { analyzeRunForensics } from "../../../../olt/scripts/src/mind/auditing/meta/evaluator.ts";
import {
  resolveStagnationIncidents,
  executeStagnationShockRecovery,
  MODE_A_AUTONOMIC_DISCOVERY,
} from "../../../../olt/scripts/src/mind/auditing/stagnation-recovery-interlock.ts";
import type { Manifest, RunState } from "../../../../olt/scripts/src/core/contracts/index.ts";
import type { StagnationAuditResult } from "../../../../olt/scripts/src/mind/preplanning/types.ts";

describe("Domain 4 Hardening Invariants (INV-AUDIT-01 to INV-AUDIT-04) (in-memory virtual)", () => {
  let scratch: string;

  beforeEach(() => {
    setupVirtualMindFS();
    scratch = scratchRoot("hardening", "test");
    fs.mkdirSync(join(scratch, ".olt"), { recursive: true });
  });

  afterEach(() => {
    cleanupVirtualMindFS();
  });

  describe("INV-AUDIT-01: Deterministic Delta Invariance", () => {
    it("sanitizes dynamic idle duration and timestamp jitter in state signatures", () => {
      const report1 = {
        is_stagnant: false,
        audited_at: "2026-08-31T00:00:00.000Z",
        idle_duration_seconds: 10,
        active_runs_count: 1,
        pending_backlog_count: 2,
        open_defects_count: 0,
        findings: ["OK in 10s at 2026-08-31T00:00:00.000Z"],
      };

      const report2 = {
        is_stagnant: false,
        audited_at: "2026-08-31T00:01:00.000Z",
        idle_duration_seconds: 70,
        active_runs_count: 1,
        pending_backlog_count: 2,
        open_defects_count: 0,
        findings: ["OK in 70s at 2026-08-31T00:01:00.000Z"],
      };

      expect(computeStateSignature(report1)).toBe(computeStateSignature(report2));
      const delta = compareReportDelta(
        report2 as unknown as StagnationAuditResult,
        report1 as unknown as StagnationAuditResult,
      );
      expect(delta.isZeroDelta).toBe(true);
      expect(delta.findingsDelta).toBe(false);
    });
  });

  describe("INV-AUDIT-02: Role-Aware Token Burning & Canonical Role Contracts", () => {
    it("exempts read-only validator and researcher roles from excessive read token burning penalties", () => {
      const manifest: Manifest = {
        version: "2.0.0",
        run_id: "run-inv-02",
        created_at: "2026-08-31T00:00:00.000Z",
        entry_task_id: "task-1",
      };
      fs.writeFileSync(join(scratch, "manifest.json"), JSON.stringify(manifest));

      const state: RunState = {
        version: "2.0.0",
        run_id: "run-inv-02",
        created_at: "2026-08-31T00:00:00.000Z",
        updated_at: "2026-08-31T00:05:00.000Z",
        status: "succeeded",
        tasks: {},
        agents: [
          {
            id: "validator-1",
            role: "validator",
            status: "released",
            tokens_in: 50000,
            tokens_out: 2000,
          },
          {
            id: "researcher-1",
            role: "researcher",
            status: "released",
            tokens_in: 50000,
            tokens_out: 2000,
          },
        ],
      };
      fs.writeFileSync(join(scratch, "state.json"), JSON.stringify(state));

      const events = [
        {
          sequence: 1,
          kind: "tool-called",
          actor: "validator-1",
          payload: { tool: "view_file", arguments: { file: "a.ts" } },
          timestamp: "2026-08-31T00:01:00.000Z",
        },
        {
          sequence: 2,
          kind: "tool-called",
          actor: "researcher-1",
          payload: { tool: "grep_search", arguments: { query: "abc" } },
          timestamp: "2026-08-31T00:02:00.000Z",
        },
      ];
      fs.writeFileSync(
        join(scratch, "events.jsonl"),
        events.map((e) => JSON.stringify(e)).join("\n") + "\n",
      );

      const result = analyzeRunForensics({ runRoot: scratch });
      const tbIncidents = result.incidents.filter((i) => i.category === "TOKEN_BURNING");
      expect(tbIncidents).toHaveLength(0);
    });
  });

  describe("INV-AUDIT-03: DAG-Grounded Concurrency Auditing", () => {
    it("does not flag FALSE_SERIALIZATION when serial tasks have explicit DAG dependencies", () => {
      const manifest: Manifest = {
        version: "2.0.0",
        run_id: "run-inv-03",
        created_at: "2026-08-31T00:00:00.000Z",
        entry_task_id: "task-1",
      };
      fs.writeFileSync(join(scratch, "manifest.json"), JSON.stringify(manifest));

      const state: RunState = {
        version: "2.0.0",
        run_id: "run-inv-03",
        created_at: "2026-08-31T00:00:00.000Z",
        updated_at: "2026-08-31T00:05:00.000Z",
        status: "succeeded",
        tasks: {
          "task-1": {
            id: "task-1",
            title: "Task 1",
            description: "Do 1",
            status: "succeeded",
            kind: "implementation",
            write_scope: ["a.ts"],
            dependencies: [],
            attempts: [
              {
                attempt: 1,
                status: "succeeded",
                agent_id: "agent-1",
                started_at: "2026-08-31T00:01:00.000Z",
                completed_at: "2026-08-31T00:02:00.000Z",
              },
            ],
          },
          "task-2": {
            id: "task-2",
            title: "Task 2",
            description: "Do 2",
            status: "succeeded",
            kind: "implementation",
            write_scope: ["b.ts"],
            dependencies: ["task-1"],
            attempts: [
              {
                attempt: 1,
                status: "succeeded",
                agent_id: "agent-2",
                started_at: "2026-08-31T00:02:30.000Z",
                completed_at: "2026-08-31T00:03:30.000Z",
              },
            ],
          },
        },
        agents: [
          { id: "agent-1", role: "implementer", status: "released" },
          { id: "agent-2", role: "implementer", status: "released" },
        ],
      };
      fs.writeFileSync(join(scratch, "state.json"), JSON.stringify(state));
      fs.writeFileSync(join(scratch, "events.jsonl"), "");

      const result = analyzeRunForensics({ runRoot: scratch });
      const fsIncidents = result.incidents.filter((i) => i.category === "FALSE_SERIALIZATION");
      expect(fsIncidents).toHaveLength(0);
      expect(result.metrics.sequentialWaveBottlenecks).toBe(0);
    });
  });

  describe("INV-AUDIT-04: Unified Shock Interlock Semantics", () => {
    it("atomically resolves LIVE_STAGNATION_DETECTED and MIND_PREPLANNING_STAGNATION defects", () => {
      const oltDir = join(scratch, ".olt");

      const defects = [
        { id: "d1", error_code: "LIVE_STAGNATION_DETECTED", status: "OPEN" },
        { id: "d2", error_code: "MIND_PREPLANNING_STAGNATION", status: "OPEN" },
        { id: "d3", error_code: "MIND_CREATIVE_STAGNATION", status: "OPEN" },
        { id: "d4", error_code: "OTHER_DEFECT", status: "OPEN" },
      ];
      fs.writeFileSync(
        join(oltDir, "defects.jsonl"),
        defects.map((d) => JSON.stringify(d)).join("\n") + "\n",
      );

      const res = resolveStagnationIncidents(scratch);
      expect(res.resolvedCount).toBe(3);

      const shock = executeStagnationShockRecovery({
        repoRoot: scratch,
        idleDurationSeconds: 200,
        stagnationThresholdSeconds: 120,
        consecutiveStagnationCount: 2,
        auditResult: {
          is_stagnant: true,
          pending_backlog_count: 1,
          open_defects_count: 0,
          idle_duration_seconds: 200,
          findings: ["Stagnated"],
        },
      });

      expect(shock.recovered).toBe(true);
      expect(shock.mode).toBe(MODE_A_AUTONOMIC_DISCOVERY);
      expect(shock.escalated).toBe(true);
    });
  });
});
