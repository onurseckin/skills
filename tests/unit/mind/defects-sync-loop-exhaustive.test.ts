import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeNormalizedFailureSignature } from "../../../olt/scripts/src/mind/defects/sync/signature.ts";
import {
  validateDefectStateTransition as validateTransitionState,
  transitionDefectState as transitionState,
  handleDefectRecurrence,
} from "../../../olt/scripts/src/mind/defects/sync/state-machine.ts";
import {
  enforceSequentialLifecycleOrdering,
  validatePhaseTransition,
  validateDefectStateTransition as validateTransitionOrder,
  transitionDefectState as transitionOrder,
} from "../../../olt/scripts/src/mind/defects/sync/order-enforcement.ts";
import {
  resolveDefectsJsonlPath,
  cleanupVestigialDefectsFile,
  parseDefectsJsonl,
  serializeDefectsJsonl,
  normalizeFindingToDefect,
  syncDoctorFindingsToDefects,
} from "../../../olt/scripts/src/mind/defects/sync/lifecycle-sync.ts";
import {
  requireDistinctLedgerPaths,
  resolveCanonicalDefectLogPath,
  resolveDefectLogPath,
  resolveCanonicalCompletedDefectsPath,
  resolveCompletedDefectsPath,
  readExistingDefectLog,
  readCompletedDefectsLog,
  writeCompletedDefectsLog,
  atomicWriteDefectLog,
  appendDefectLogEntry,
  appendCompletedDefectLogEntry,
  mergeDefectsById,
  formulateBoundaryViolationHypothesis,
} from "../../../olt/scripts/src/mind/defects/loop/ledger-ops.ts";
import {
  auditDefectLog,
  formatDefectAuditBrief,
  logBoundaryViolationDefect,
  executeDefectAudit,
} from "../../../olt/scripts/src/mind/defects/loop/audit.ts";
import {
  normalizeStatus,
  mergeDefectSets,
} from "../../../olt/scripts/src/mind/defects/aggregator/aggregator.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type { DefectEntry } from "../../../olt/scripts/src/mind/defects/core/types.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  }
  roots.length = 0;
});

describe("Defects Sync, Loop, and Aggregator - Exhaustive Unit Tests", () => {
  describe("Signature & State Machine", () => {
    it("computes deterministic failure signatures across platform paths and message variations", () => {
      const sig1 = computeNormalizedFailureSignature({
        category: "syntax",
        code: "ERR_SYNTAX",
        path: "src\\index.ts",
        line: 12,
        message: "Unexpected token   semicolon",
      });

      const sig2 = computeNormalizedFailureSignature({
        category: "SYNTAX ",
        code: "err_syntax",
        file: "src/index.ts",
        line: 12,
        message: "unexpected token semicolon",
      });

      expect(sig1).toBe(sig2);
      expect(sig1.length).toBe(64);

      const sigDefault = computeNormalizedFailureSignature({
        code: "ERR_DEFAULT",
      });
      expect(sigDefault).toBeDefined();
    });

    it("validates defect state machine transitions and proof enforcement on regressions", () => {
      // open -> in_progress (valid)
      expect(validateTransitionState("open", "in_progress")).toBe(true);

      // open -> invalid target (invalid)
      expect(validateTransitionState("open", "not_a_valid_status")).toBe(false);

      // Reopening resolved defect without proof fails
      expect(validateTransitionState("resolved", "open")).toBe(false);

      // Reopening resolved defect with valid proof succeeds
      const validProof = {
        commit_sha: "abc1234",
        test_assertion: "expect(true).toBe(false)",
        task_id: "task-123",
      };
      expect(validateTransitionState("resolved", "open", validProof as any)).toBe(true);

      const defect: DefectEntry = {
        id: "def-1",
        type: "syntax_error",
        category: "code_defect",
        severity: "critical",
        status: "open",
        observation: "Missing semicolon",
      };

      // Valid transition
      const progressed = transitionState(defect, "in_progress");
      expect(progressed.status).toBe("in_progress");

      // Invalid transition throws HarnessError
      expect(() => transitionState({ ...defect, status: "resolved" as any }, "open")).toThrow(
        HarnessError,
      );

      // Transition with proof
      const reopened = transitionState(
        { ...defect, status: "resolved" as any },
        "open",
        validProof as any,
      );
      expect(reopened.status).toBe("open");
      expect(reopened.count).toBe(2);

      // handleDefectRecurrence with and without strict proof
      const resolvedDefect: DefectEntry = { ...defect, status: "resolved" as any, count: 1 };
      const recurredDeliberating = handleDefectRecurrence(resolvedDefect);
      expect(recurredDeliberating.status).toBe("deliberating");
      expect(recurredDeliberating.count).toBe(2);

      const recurredOpen = handleDefectRecurrence(resolvedDefect, {
        proof: validProof as any,
        requireStrictProof: true,
      });
      expect(recurredOpen.status).toBe("open");
      expect(recurredOpen.count).toBe(2);

      // Normal open defect recurrence
      const openDefectRecur = handleDefectRecurrence(defect);
      expect(openDefectRecur.status).toBe("open");
      expect(openDefectRecur.count).toBe(2);
    });
  });

  describe("Order Enforcement & Lifecycle Phases", () => {
    it("validates sequential lifecycle command ordering and catches out of order executions", () => {
      expect(validatePhaseTransition("plan:init", "run:start")).toBe(true);
      expect(validatePhaseTransition("run:start", "plan:init")).toBe(false);
      expect(validatePhaseTransition("unknown-cmd", "run:start")).toBe(true);

      const validSeq = ["plan:init", "plan:enhance", "run:start", "task:claim", "quiesce"];
      const orderRes = enforceSequentialLifecycleOrdering(validSeq);
      expect(orderRes.valid).toBe(true);
      expect(orderRes.highestPhaseReached).toBe("quiesce");

      const invalidSeq = ["run:start", "plan:init"];
      expect(() => enforceSequentialLifecycleOrdering(invalidSeq)).toThrow(HarnessError);
    });

    it("order-enforcement defect transitions with proof validation", () => {
      const defect: DefectEntry = {
        id: "def-order-1",
        type: "lint_error",
        category: "code_defect",
        severity: "warning",
        status: "open",
      };

      const validProof = {
        commit_sha: "sha-1",
        test_assertion: "assertion",
        task_id: "task-1",
      };

      expect(validateTransitionOrder("completed", "open", validProof as any)).toBe(true);
      expect(validateTransitionOrder("completed", "open", {} as any)).toBe(false);

      const tRes = transitionOrder(
        { ...defect, status: "completed" as any },
        "open",
        validProof as any,
      );
      expect(tRes.status).toBe("open");

      expect(() => transitionOrder({ ...defect, status: "completed" as any }, "open")).toThrow(
        HarnessError,
      );
    });
  });

  describe("Lifecycle Sync & Doctor Defect Synchronization", () => {
    it("parses, serializes, and cleans up vestigial defects files", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "defect-sync-test-"));
      roots.push(tmpDir);

      const canonicalPath = resolveDefectsJsonlPath(join(tmpDir, ".olt", "defects.jsonl"));
      expect(canonicalPath).toBe(join(tmpDir, ".olt", "defects.jsonl"));

      // vestigial file cleanup
      const oltSub = join(tmpDir, "olt");
      mkdirSync(oltSub, { recursive: true });
      const vestigialPath = join(oltSub, "defects.jsonl");
      writeFileSync(vestigialPath, JSON.stringify({ id: "vestigial-1", type: "syntax" }) + "\n");

      cleanupVestigialDefectsFile(canonicalPath);
      expect(readExistingDefectLog(canonicalPath).length).toBe(1);

      // parseDefectsJsonl with empty content, valid content, and corrupt lines
      expect(parseDefectsJsonl("")).toEqual([]);
      const raw = `
{"id":"d-1","type":"type_err","category":"code_defect","status":"open"}
corrupt_json_line
{"id":"d-2","type":"boundary","severity":"high"}
`;
      const parsed = parseDefectsJsonl(raw, { capsuleRoot: "/my/capsule" });
      expect(parsed.length).toBe(2);
      expect(parsed[1]!.capsule_root).toBe("/my/capsule");

      const serialized = serializeDefectsJsonl(parsed);
      expect(serialized).toContain("d-1");
      expect(serializeDefectsJsonl([])).toBe("");
    });

    it("normalizes doctor findings and synchronizes to ledger with new, updated, and repaired items", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "doctor-sync-test-"));
      roots.push(tmpDir);
      const defectsPath = join(tmpDir, ".olt", "defects.jsonl");

      const norm = normalizeFindingToDefect(
        {
          code: "RULE_01",
          file: "src/app.ts",
          line: 42,
          message: "Implicit any found",
          severity: "error",
          remediation: "Add explicit type annotation",
        },
        "2026-08-31T00:00:00Z",
      );
      expect(norm.id).toContain("doctor-rule-01");
      expect(norm.severity).toBe("high");

      const resSync = syncDoctorFindingsToDefects(
        [
          {
            id: norm.id,
            code: "RULE_01",
            file: "src/app.ts",
            message: "Implicit any found",
          },
          {
            code: "RULE_02",
            file: "src/other.ts",
            message: "Unused variable",
            repaired: true, // skipped/unchanged
          },
        ],
        { defectsPath },
      );

      expect(resSync.newlyCreated).toBe(1);
      expect(resSync.unchanged).toBe(1);

      // Dry-run sync
      const dryRunRes = syncDoctorFindingsToDefects(
        [
          {
            id: norm.id,
            code: "RULE_01",
            file: "src/app.ts",
            message: "Implicit any found",
          },
        ],
        { defectsPath, dryRun: true },
      );
      expect(dryRunRes.existingUpdated).toBe(1);
    });
  });

  describe("Ledger Operations & Boundary Violation Hypothesis", () => {
    it("manages active and completed defect logs with atomic writes and merging", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "ledger-ops-test-"));
      roots.push(tmpDir);

      const activePath = join(tmpDir, "active.jsonl");
      const completedPath = join(tmpDir, "completed.jsonl");

      expect(() => requireDistinctLedgerPaths(activePath, activePath)).toThrow(HarnessError);
      expect(() => requireDistinctLedgerPaths(activePath, completedPath)).not.toThrow();

      expect(resolveCanonicalDefectLogPath(tmpDir)).toContain(".olt/defects.jsonl");
      expect(resolveDefectLogPath(activePath)).toBe(activePath);
      expect(resolveCanonicalCompletedDefectsPath(tmpDir)).toContain(
        ".olt/completed-defects.jsonl",
      );
      expect(resolveCompletedDefectsPath(completedPath)).toBe(completedPath);

      // Atomic write and read
      const entries: DefectEntry[] = [
        { id: "d-1", type: "t1", category: "code_defect", severity: "low", status: "open" },
        { id: "d-2", type: "t2", category: "code_defect", severity: "medium", status: "open" },
      ];
      atomicWriteDefectLog(entries, activePath);
      expect(readExistingDefectLog(activePath).length).toBe(2);

      // Appending entries
      appendDefectLogEntry(
        { id: "d-3", type: "t3", category: "code_defect", severity: "high", status: "open" },
        { customPath: activePath },
      );
      expect(readExistingDefectLog(activePath).length).toBe(3);

      // Completed log append and duplicate bypass
      appendCompletedDefectLogEntry(
        { id: "d-1", type: "t1", category: "code_defect", severity: "low", status: "resolved" },
        completedPath,
      );
      appendCompletedDefectLogEntry(
        { id: "d-1", type: "t1", category: "code_defect", severity: "low", status: "resolved" },
        completedPath,
      );
      expect(readExistingDefectLog(completedPath).length).toBe(1);

      // Merge defects by ID
      const merged = mergeDefectsById(
        [{ id: "d-1", type: "old" } as any],
        [{ id: "d-1", type: "new" } as any, { id: "d-2", type: "other" } as any],
      );
      expect(merged.length).toBe(2);
      expect(merged[0]!.type).toBe("new");
    });

    it("formulates boundary violation hypotheses for diverse supervisor breach patterns", () => {
      const hCoord = formulateBoundaryViolationHypothesis({
        id: "viol-coord",
        type: "coordinator_code_writing",
        observation: "Coordinator wrote code directly",
        role: "coordinator",
        agent_id: "coord-1",
      });
      expect(hCoord.root_cause).toContain("Tier 2 Coordinator");

      const hOrch = formulateBoundaryViolationHypothesis({
        id: "viol-orch",
        type: "orchestrator_direct_implementation",
        observation: "Orchestrator implemented task directly",
        role: "orchestrator",
      });
      expect(hOrch.root_cause).toContain("Tier 1 Orchestrator");

      const hTest = formulateBoundaryViolationHypothesis({
        id: "viol-test",
        type: "unassigned_test_running",
        observation: "Unassigned test executed",
      });
      expect(hTest.root_cause).toContain("test running confinement");

      const hSpawn = formulateBoundaryViolationHypothesis({
        id: "viol-spawn",
        type: "cross_tier_spawning",
        observation: "Supervisory agent cross-tier spawned",
      });
      expect(hSpawn.root_cause).toContain("hierarchical spawning");
    });
  });

  describe("Audit Loop & Defect Aggregator", () => {
    it("audits defect logs, formats briefs, and logs boundary defects", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "defect-audit-test-"));
      roots.push(tmpDir);

      const defectsPath = join(tmpDir, "defects.jsonl");
      writeFileSync(
        defectsPath,
        [
          JSON.stringify({ id: "d-1", type: "code", category: "code_defect", status: "resolved" }),
          JSON.stringify({
            id: "d-2",
            type: "model",
            category: "model_reasoning_error",
            status: "open",
            count: 3,
          }),
          JSON.stringify({
            id: "d-3",
            type: "other",
            category: "documentation",
            status: "wontfix",
          }),
        ].join("\n") + "\n",
      );

      const report = auditDefectLog(tmpDir);
      expect(report.total_defects).toBe(3);
      expect(report.open_count).toBe(1);
      expect(report.resolved_count).toBe(1);
      expect(report.wontfix_count).toBe(1);

      const brief = formatDefectAuditBrief(report, { maxLines: 50 });
      expect(brief).toContain("Defect Audit & Remediation Brief");
      expect(brief).toContain("resolved");
      expect(brief).toContain("open");

      const briefTruncated = formatDefectAuditBrief(report, 2);
      expect(briefTruncated).toContain("truncated");

      const emptyBrief = formatDefectAuditBrief({ ...report, defects: [] });
      expect(emptyBrief).toContain("No defect records detected");

      // logBoundaryViolationDefect
      expect(() =>
        logBoundaryViolationDefect({
          violation_type: "",
          observation: "obs",
        }),
      ).toThrow(HarnessError);

      expect(() =>
        logBoundaryViolationDefect({
          violation_type: "type",
          observation: "",
        }),
      ).toThrow(HarnessError);

      const logged = logBoundaryViolationDefect({
        violation_type: "spawning",
        observation: "Tier 3 spawned subagent",
        agent_id: "agent-1",
      });
      expect(logged.category).toBe("boundary_violation");
      expect(logged.severity).toBe("critical");
    });

    it("normalizes statuses and merges defect sets in aggregator", () => {
      expect(normalizeStatus()).toBe("open");
      expect(normalizeStatus("wont_fix")).toBe("wontfix");
      expect(normalizeStatus("wont-fix")).toBe("wontfix");
      expect(normalizeStatus("completed")).toBe("resolved");
      expect(normalizeStatus("other")).toBe("open");

      const setA: any[] = [
        { id: "d-1", dedup_key: "k1", count: 1, severity: "low" },
        { id: "d-2", dedup_key: "k2", count: 1, severity: "medium" },
      ];
      const setB: any[] = [
        { id: "d-1", dedup_key: "k1", count: 2, severity: "high" },
        { id: "d-3", dedup_key: "k3", count: 1, severity: "low" },
      ];

      const merged = mergeDefectSets(setA, setB);
      expect(merged.length).toBe(3);
      const d1 = merged.find((m) => m.id === "d-1");
      expect(d1?.count).toBe(3);
    });
  });
});
