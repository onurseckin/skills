import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  compareReportDelta,
  computeStateSignature,
  sanitizeFindingForDelta,
} from "../../../olt/scripts/src/mind/auditing/index.ts";
import {
  executeStagnationShockRecovery,
  resolveStagnationIncidents,
  MODE_A_AUTONOMIC_DISCOVERY,
} from "../../../olt/scripts/src/mind/auditing/stagnation-recovery-interlock.ts";
import { analyzeRunForensics } from "../../../olt/scripts/src/mind/auditing/meta/index.ts";
import type { Manifest, RunState } from "../../../olt/scripts/src/core/contracts/index.ts";

describe("Domain 4 Hardening Invariants (INV-AUDIT-01 to INV-AUDIT-05)", () => {
  describe("INV-AUDIT-01: Deterministic Delta Invariance", () => {
    it("sanitizes dynamic idle duration and timestamp jitter in state signatures", () => {
      const finding1 =
        "Unplanned items exist (3), but idle duration (12.4s) is within the allowable window (180s).";
      const finding2 =
        "Unplanned items exist (3), but idle duration (18.9s) is within the allowable window (180s).";

      expect(sanitizeFindingForDelta(finding1)).toBe(sanitizeFindingForDelta(finding2));

      const report1 = {
        is_stagnant: false,
        pending_backlog_count: 3,
        open_defects_count: 0,
        findings: [finding1],
      };
      const report2 = {
        is_stagnant: false,
        pending_backlog_count: 3,
        open_defects_count: 0,
        findings: [finding2],
      };

      expect(computeStateSignature(report1)).toBe(computeStateSignature(report2));
      const delta = compareReportDelta(report2, report1);
      expect(delta.isZeroDelta).toBe(true);
      expect(delta.findingsDelta).toBe(false);
    });
  });

  describe("INV-AUDIT-02: Role-Aware Token Burning & Canonical Role Contracts", () => {
    it("exempts read-only validator and researcher roles from excessive read token burning penalties", () => {
      const scratch = join(
        tmpdir(),
        `test-inv-02-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      mkdirSync(scratch, { recursive: true });

      const manifest: Manifest = {
        version: "2.0.0",
        run_id: "run-inv-02",
        created_at: "2026-08-31T00:00:00.000Z",
        entry_task_id: "task-1",
      };
      writeFileSync(join(scratch, "manifest.json"), JSON.stringify(manifest));

      const state: RunState = {
        version: "2.0.0",
        run_id: "run-inv-02",
        created_at: "2026-08-31T00:00:00.000Z",
        updated_at: "2026-08-31T00:05:00.000Z",
        status: "succeeded",
        tasks: {},
        agents: [
          { id: "validator-1", role: "validator", status: "released" },
          { id: "researcher-1", role: "researcher", status: "released" },
        ],
      };
      writeFileSync(join(scratch, "state.json"), JSON.stringify(state));

      const events = [];
      for (let i = 1; i <= 10; i++) {
        events.push({
          sequence: i,
          kind: "tool-called",
          actor: "validator-1",
          timestamp: `2026-08-31T00:01:${String(i).padStart(2, "0")}.000Z`,
          payload: { tool: "view_file", arguments: { AbsolutePath: `/src/file${i}.ts` } },
        });
        events.push({
          sequence: 10 + i,
          kind: "tool-called",
          actor: "researcher-1",
          timestamp: `2026-08-31T00:02:${String(i).padStart(2, "0")}.000Z`,
          payload: { tool: "grep_search", arguments: { Query: "test" } },
        });
      }
      writeFileSync(
        join(scratch, "events.jsonl"),
        events.map((e) => JSON.stringify(e)).join("\n") + "\n",
      );

      const result = analyzeRunForensics({ runRoot: scratch });
      const tbIncidents = result.incidents.filter((i) => i.category === "TOKEN_BURNING");
      expect(tbIncidents).toHaveLength(0);

      rmSync(scratch, { recursive: true, force: true });
    });
  });

  describe("INV-AUDIT-03: DAG-Grounded Concurrency Auditing", () => {
    it("does not flag FALSE_SERIALIZATION when serial tasks have explicit DAG dependencies", () => {
      const scratch = join(
        tmpdir(),
        `test-inv-03-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      mkdirSync(scratch, { recursive: true });

      const manifest: Manifest = {
        version: "2.0.0",
        run_id: "run-inv-03",
        created_at: "2026-08-31T00:00:00.000Z",
        entry_task_id: "task-1",
      };
      writeFileSync(join(scratch, "manifest.json"), JSON.stringify(manifest));

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
            description: "Task 1",
            status: "succeeded",
            kind: "implementation",
            write_scope: ["src/a.ts"],
            attempts: [
              {
                attempt: 1,
                status: "succeeded",
                started_at: "2026-08-31T00:01:00.000Z",
                completed_at: "2026-08-31T00:02:00.000Z",
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
            dependencies: ["task-1"],
            attempts: [
              {
                attempt: 1,
                status: "succeeded",
                started_at: "2026-08-31T00:02:05.000Z",
                completed_at: "2026-08-31T00:03:00.000Z",
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
            dependencies: ["task-2"],
            attempts: [
              {
                attempt: 1,
                status: "succeeded",
                started_at: "2026-08-31T00:03:05.000Z",
                completed_at: "2026-08-31T00:04:00.000Z",
              },
            ],
          },
        },
        agents: [],
      };
      writeFileSync(join(scratch, "state.json"), JSON.stringify(state));
      writeFileSync(join(scratch, "events.jsonl"), "");

      const result = analyzeRunForensics({ runRoot: scratch });
      const fsIncidents = result.incidents.filter((i) => i.category === "FALSE_SERIALIZATION");
      expect(fsIncidents).toHaveLength(0);
      expect(result.metrics.sequentialWaveBottlenecks).toBe(0);

      rmSync(scratch, { recursive: true, force: true });
    });
  });

  describe("INV-AUDIT-04: Unified Shock Interlock Semantics", () => {
    it("atomically resolves LIVE_STAGNATION_DETECTED and MIND_PREPLANNING_STAGNATION defects", () => {
      const scratch = join(
        tmpdir(),
        `test-inv-04-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      const oltDir = join(scratch, ".olt");
      mkdirSync(oltDir, { recursive: true });

      const defects = [
        { id: "d1", error_code: "LIVE_STAGNATION_DETECTED", status: "OPEN" },
        { id: "d2", error_code: "MIND_PREPLANNING_STAGNATION", status: "OPEN" },
        { id: "d3", error_code: "MIND_CREATIVE_STAGNATION", status: "OPEN" },
        { id: "d4", error_code: "OTHER_DEFECT", status: "OPEN" },
      ];
      writeFileSync(
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

      rmSync(scratch, { recursive: true, force: true });
    });
  });

  describe("INV-AUDIT-05: Context-Aware Metric Scaling & Sample-Guarded Straggler Detection", () => {
    it("handles N=1 absolute timeout guard for stragglers", () => {
      const scratch = join(
        tmpdir(),
        `test-inv-05-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      mkdirSync(scratch, { recursive: true });

      const manifest: Manifest = {
        version: "2.0.0",
        run_id: "run-inv-05",
        created_at: "2026-08-31T00:00:00.000Z",
        entry_task_id: "task-1",
      };
      writeFileSync(join(scratch, "manifest.json"), JSON.stringify(manifest));

      const stateN1: RunState = {
        version: "2.0.0",
        run_id: "run-inv-05",
        created_at: "2026-08-31T00:00:00.000Z",
        updated_at: "2026-08-31T00:06:00.000Z",
        status: "succeeded",
        tasks: {
          "task-solo": {
            id: "task-solo",
            title: "Solo Task",
            description: "Solo Task",
            status: "succeeded",
            kind: "implementation",
            attempts: [
              {
                attempt: 1,
                status: "succeeded",
                started_at: "2026-08-31T00:00:00.000Z",
                completed_at: "2026-08-31T00:05:50.000Z",
              },
            ],
          },
        },
        agents: [],
      };
      writeFileSync(join(scratch, "state.json"), JSON.stringify(stateN1));
      writeFileSync(join(scratch, "events.jsonl"), "");

      const resultN1 = analyzeRunForensics({ runRoot: scratch });
      const strIncN1 = resultN1.incidents.find((i) => i.category === "STRAGGLER");
      expect(strIncN1).toBeDefined();
      expect(strIncN1?.taskId).toBe("task-solo");

      rmSync(scratch, { recursive: true, force: true });
    });

    it("distinguishes active prompt token bloat from cumulative session token saturation", () => {
      const scratch = join(
        tmpdir(),
        `test-inv-05-tokens-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      mkdirSync(scratch, { recursive: true });

      const manifest: Manifest = {
        version: "2.0.0",
        run_id: "run-inv-05-tokens",
        created_at: "2026-08-31T00:00:00.000Z",
        entry_task_id: "task-1",
      };
      writeFileSync(join(scratch, "manifest.json"), JSON.stringify(manifest));

      const state: RunState = {
        version: "2.0.0",
        run_id: "run-inv-05-tokens",
        created_at: "2026-08-31T00:00:00.000Z",
        updated_at: "2026-08-31T00:05:00.000Z",
        status: "succeeded",
        tasks: {},
        agents: [
          {
            id: "agent-prompt-heavy",
            role: "implementer",
            status: "released",
            tokens_in: 130000,
            tokens_out: 2000,
          },
        ],
      };
      writeFileSync(join(scratch, "state.json"), JSON.stringify(state));
      writeFileSync(join(scratch, "events.jsonl"), "");

      const result = analyzeRunForensics({ runRoot: scratch });
      const coInc = result.incidents.find((i) => i.category === "CONTEXT_OVERFLOW");
      expect(coInc).toBeDefined();
      expect(coInc?.title).toContain("Active Prompt Token Bloat");

      rmSync(scratch, { recursive: true, force: true });
    });
  });
});
