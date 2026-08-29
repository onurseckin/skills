import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  auditDefectLog,
  autoPromoteDefect,
  categorizeDefect,
  formatDefectAuditBrief,
  formulateDefectCandidates,
  generateDefectRegressionTest,
  generateRegressionTestSuite,
  isDefectEligibleForPromotion,
  parseDefectLog,
  promoteResolvedDefects,
  readCompletedDefectsLog,
  resolveDefect,
  serializeDefectLog,
  validateRegressionTest,
  validateResolutionProof,
  writeCompletedDefectsLog,
  type DefectAuditReport,
  type DefectCategory,
  type DefectEntry,
  type DefectResolutionProof,
  type MindCandidateProposal,
} from "../../../olt/scripts/src/mind/defects.ts";

const tempRoots: string[] = [];

afterEach(() => {
  for (let i = 0; i < tempRoots.length; i += 1) {
    const r = tempRoots[i];
    if (r !== undefined) {
      try {
        rmSync(r, { recursive: true, force: true });
      } catch {
        // Ignore cleanup failures
      }
    }
  }
  tempRoots.length = 0;
});

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

describe("Core Defect Categorization & Resolution Tracking Engine", () => {
  describe("categorizeDefect", () => {
    test("preserves existing valid categories", () => {
      const b1 = { category: "code_defect" };
      const b2 = { category: "model_reasoning_error" };
      const b3 = { category: "boundary_violation" };

      expect(categorizeDefect(b1)).toBe("code_defect");
      expect(categorizeDefect(b2)).toBe("model_reasoning_error");
      expect(categorizeDefect(b3)).toBe("boundary_violation");
    });

    test("categorizes boundary violations from type keywords", () => {
      expect(categorizeDefect({ type: "main_thread_direct_execution" })).toBe("boundary_violation");
      expect(categorizeDefect({ type: "main_thread_boundary_violation" })).toBe(
        "boundary_violation",
      );
      expect(categorizeDefect({ type: "role_escalation" })).toBe("boundary_violation");
      expect(categorizeDefect({ type: "unauthorized_mutation" })).toBe("boundary_violation");
      expect(categorizeDefect({ type: "restraint_violation" })).toBe("boundary_violation");
      expect(categorizeDefect({ type: "thread_authority_breach" })).toBe("boundary_violation");
      expect(categorizeDefect({ type: "tier_escaped" })).toBe("boundary_violation");
      expect(categorizeDefect({ type: "permission_denied" })).toBe("boundary_violation");
    });

    test("categorizes boundary violations from observation or remediation text", () => {
      const entry = {
        type: "unknown_event",
        observation: "Main thread attempted direct file write without subagent boundary delegation",
        remediation: "Dispatch Tier 3 Implementer via invoke_subagent",
      };
      expect(categorizeDefect(entry)).toBe("boundary_violation");

      const entry2 = {
        type: "guard_alert",
        observation: "Execution detected under Tier 0 human shell trying automated mutation",
        remediation: "Enforce thread restraint active",
      };
      expect(categorizeDefect(entry2)).toBe("boundary_violation");
    });

    test("categorizes model reasoning errors from type or description", () => {
      expect(categorizeDefect({ type: "hallucination_detected" })).toBe("model_reasoning_error");
      expect(categorizeDefect({ type: "plan_drift" })).toBe("model_reasoning_error");
      expect(categorizeDefect({ type: "intent_drift" })).toBe("model_reasoning_error");
      expect(categorizeDefect({ type: "instruction_drift" })).toBe("model_reasoning_error");
      expect(categorizeDefect({ type: "self_critique_failure" })).toBe("model_reasoning_error");
      expect(categorizeDefect({ type: "context_loss" })).toBe("model_reasoning_error");

      const entry = {
        type: "planner_error",
        observation: "Model made an incorrect premise regarding state file schema",
        remediation: "Perform re-reading and self-audit before planning",
      };
      expect(categorizeDefect(entry)).toBe("model_reasoning_error");

      const entry2 = {
        type: "anomaly",
        observation: "Agent produced an illogical decision contradicting requirements",
        remediation: "Address reasoning error with counterfactual check",
      };
      expect(categorizeDefect(entry2)).toBe("model_reasoning_error");
    });

    test("defaults other defects to code_defect", () => {
      expect(categorizeDefect({ type: "syntax_error" })).toBe("code_defect");
      expect(categorizeDefect({ type: "type_error" })).toBe("code_defect");
      expect(categorizeDefect({ type: "test_failure" })).toBe("code_defect");
      expect(categorizeDefect({ type: "failing_gate" })).toBe("code_defect");
      expect(categorizeDefect({ type: "runtime_error" })).toBe("code_defect");
      expect(categorizeDefect({})).toBe("code_defect");
      expect(categorizeDefect({ type: "unrecognized" })).toBe("code_defect");
    });
  });

  describe("parseDefectLog", () => {
    test("returns empty array for empty or whitespace content", () => {
      expect(parseDefectLog("")).toEqual([]);
      expect(parseDefectLog("   \n\n  \t ")).toEqual([]);
    });

    test("parses single and multiple valid JSONL defect lines", () => {
      const b1 = {
        id: "defect-1",
        type: "main_thread_direct_execution",
        severity: "critical",
        timestamp: "2026-08-22T00:00:00.000Z",
        observation: "Main thread executed task directly",
        remediation: "Dispatch Tier 3 Implementer",
      };
      const b2 = {
        id: "defect-2",
        type: "syntax_error",
        severity: "warning",
        timestamp: "2026-08-22T01:00:00.000Z",
        observation: "Missing semicolon",
        remediation: "Fix syntax",
        status: "resolved",
        resolution: {
          task_id: "task-fix-syntax",
          test_assertion: "bun test tests/unit/syntax.test.ts",
          resolved_at: "2026-08-22T02:00:00.000Z",
          commit_sha: "abc1234",
        },
      };

      const jsonl = `${JSON.stringify(b1)}\n${JSON.stringify(b2)}\n`;
      const parsed = parseDefectLog(jsonl, { capsuleRoot: "/tmp/capsule-1" });

      expect(parsed.length).toBe(2);

      const entry1 = parsed[0];
      expect(entry1 !== undefined).toBeTrue();
      if (entry1 !== undefined) {
        expect(entry1.id).toBe("defect-1");
        expect(entry1.category).toBe("boundary_violation");
        expect(entry1.status).toBe("open");
        expect(entry1.capsule_root).toBe("/tmp/capsule-1");
        expect(entry1.resolution).toBeUndefined();
      }

      const entry2 = parsed[1];
      expect(entry2 !== undefined).toBeTrue();
      if (entry2 !== undefined) {
        expect(entry2.id).toBe("defect-2");
        expect(entry2.category).toBe("code_defect");
        expect(entry2.status).toBe("resolved");
        expect(entry2.resolution?.task_id).toBe("task-fix-syntax");
        expect(entry2.resolution?.commit_sha).toBe("abc1234");
      }
    });

    test("skips malformed JSON and non-object lines gracefully", () => {
      const content = [
        "not valid json",
        JSON.stringify({
          id: "valid-1",
          type: "lint_error",
          observation: "Unused var",
        }),
        "42",
        "null",
        JSON.stringify({
          id: "valid-2",
          type: "logic_error",
          observation: "Reasoning error in calculation",
        }),
      ].join("\n");

      const parsed = parseDefectLog(content);
      expect(parsed.length).toBe(2);
      expect(parsed[0]?.id).toBe("valid-1");
      expect(parsed[1]?.id).toBe("valid-2");
      expect(parsed[1]?.category).toBe("model_reasoning_error");
    });

    test("handles null resolution cleanly", () => {
      const content = JSON.stringify({
        id: "defect-null-res",
        type: "type_error",
        status: "open",
        resolution: null,
      });

      const parsed = parseDefectLog(content);
      expect(parsed.length).toBe(1);
      expect(parsed[0]?.resolution).toBeNull();
    });
  });

  describe("serializeDefectLog", () => {
    test("returns empty string for empty inputs", () => {
      expect(serializeDefectLog([])).toBe("");
    });

    test("serializes defect records into valid JSONL", () => {
      const entries: DefectEntry[] = [
        {
          id: "defect-s1",
          type: "role_escalation",
          severity: "critical",
          timestamp: "2026-08-22T04:00:00.000Z",
          category: "boundary_violation",
          status: "open",
          observation: "Unauthorized lease acquisition",
          remediation: "Revoke lease",
        },
        {
          id: "defect-s2",
          type: "hallucination_detected",
          severity: "warning",
          timestamp: "2026-08-22T04:30:00.000Z",
          category: "model_reasoning_error",
          status: "wontfix",
          observation: "Fabricated API parameter",
          remediation: "Review schema documentation",
        },
      ];

      const serialized = serializeDefectLog(entries);
      expect(serialized.endsWith("\n")).toBeTrue();

      const roundTrip = parseDefectLog(serialized);
      expect(roundTrip.length).toBe(2);
      expect(roundTrip[0]?.id).toBe("defect-s1");
      expect(roundTrip[0]?.category).toBe("boundary_violation");
      expect(roundTrip[1]?.id).toBe("defect-s2");
      expect(roundTrip[1]?.status).toBe("wontfix");
    });
  });

  describe("resolveDefect", () => {
    const sampleDefect: DefectEntry = {
      id: "defect-r1",
      type: "unauthorized_mutation",
      severity: "critical",
      timestamp: "2026-08-22T05:00:00.000Z",
      category: "boundary_violation",
      status: "open",
      observation: "Direct edit on main branch",
      remediation: "Isolate to task workspace branch",
    };

    test("successfully resolves defect with valid proof", () => {
      const proof: DefectResolutionProof = {
        task_id: "task-auth-fix",
        test_assertion: "bun test tests/unit/auth.test.ts",
        resolved_at: "2026-08-22T05:15:00.000Z",
        commit_sha: "commit-998877",
      };

      const resolved = resolveDefect(sampleDefect, proof);

      expect(resolved.status).toBe("resolved");
      expect(resolved.resolution?.task_id).toBe("task-fix" ? "task-auth-fix" : "task-auth-fix");
      expect(resolved.resolution?.test_assertion).toBe("bun test tests/unit/auth.test.ts");
      expect(resolved.resolution?.resolved_at).toBe("2026-08-22T05:15:00.000Z");
      expect(resolved.resolution?.commit_sha).toBe("commit-998877");
      expect(resolved.id).toBe(sampleDefect.id);
      expect(sampleDefect.status).toBe("open"); // Immutable
    });

    test("throws HarnessError on invalid or missing proof fields", () => {
      const invalidProof1 = {
        task_id: "",
        test_assertion: "bun test",
        resolved_at: "2026-08-22T05:15:00.000Z",
      };
      expect(() => resolveDefect(sampleDefect, invalidProof1)).toThrow(HarnessError);

      const invalidProof2 = {
        task_id: "task-1",
        test_assertion: "   ",
        resolved_at: "2026-08-22T05:15:00.000Z",
      };
      expect(() => resolveDefect(sampleDefect, invalidProof2)).toThrow(HarnessError);

      const invalidProof3 = {
        task_id: "task-1",
        test_assertion: "bun test",
        resolved_at: "",
      };
      expect(() => resolveDefect(sampleDefect, invalidProof3)).toThrow(HarnessError);
    });
  });

  describe("auditDefectLog", () => {
    test("handles empty capsule roots list", () => {
      const report = auditDefectLog([]);
      expect(report.total_defects).toBe(0);
      expect(report.open_count).toBe(0);
      expect(report.resolved_count).toBe(0);
      expect(report.wontfix_count).toBe(0);
      expect(report.defects).toEqual([]);
      expect(report.capsules_audited).toEqual([]);
    });

    test("audits defects across multiple capsules and aggregates counts", () => {
      const testDir = createTempDir("defect-audit-test-");

      const capsule1 = join(testDir, "capsule-1");
      const capsule2 = join(testDir, "capsule-2");
      mkdirSync(capsule1, { recursive: true });
      mkdirSync(capsule2, { recursive: true });

      const defectA: DefectEntry = {
        id: "b-1",
        type: "main_thread_direct_execution",
        severity: "critical",
        timestamp: "2026-08-22T01:00:00.000Z",
        category: "boundary_violation",
        status: "open",
        observation: "Main thread edit",
        remediation: "Delegate to worker",
      };

      const defectB: DefectEntry = {
        id: "b-2",
        type: "hallucination",
        severity: "warning",
        timestamp: "2026-08-22T02:00:00.000Z",
        category: "model_reasoning_error",
        status: "resolved",
        observation: "Wrong assumption",
        remediation: "Verify facts",
        resolution: {
          task_id: "task-verify",
          test_assertion: "bun test",
          resolved_at: "2026-08-22T03:00:00.000Z",
        },
      };

      const defectC: DefectEntry = {
        id: "b-3",
        type: "syntax_defect",
        severity: "warning",
        timestamp: "2026-08-22T04:00:00.000Z",
        category: "code_defect",
        status: "wontfix",
        observation: "Legacy artifact syntax",
        remediation: "Ignore legacy file",
      };

      writeFileSync(
        join(capsule1, "defects.jsonl"),
        `${JSON.stringify(defectA)}\n${JSON.stringify(defectB)}\n`,
      );
      writeFileSync(join(capsule2, "defects.jsonl"), `${JSON.stringify(defectC)}\n`);

      const report: DefectAuditReport = auditDefectLog([capsule1, capsule2]);

      expect(report.total_defects).toBe(3);
      expect(report.open_count).toBe(1);
      expect(report.resolved_count).toBe(1);
      expect(report.wontfix_count).toBe(1);
      expect(report.by_category.boundary_violation).toBe(1);
      expect(report.by_category.model_reasoning_error).toBe(1);
      expect(report.by_category.code_defect).toBe(1);
      expect(report.by_severity.critical).toBe(1);
      expect(report.by_severity.warning).toBe(2);
      expect(report.capsules_audited.length).toBe(2);
    });

    test("deduplicates defects by ID and prioritizes resolved status updates", () => {
      const testDir = createTempDir("defect-dedup-test-");
      const capsuleDir = join(testDir, "capsule-main");
      mkdirSync(capsuleDir, { recursive: true });

      const initialDefect: DefectEntry = {
        id: "b-dedup-1",
        type: "code_defect",
        severity: "warning",
        timestamp: "2026-08-22T01:00:00.000Z",
        category: "code_defect",
        status: "open",
        observation: "Initial failure",
        remediation: "Fix in task",
      };

      const resolvedDefect: DefectEntry = {
        id: "b-dedup-1",
        type: "code_defect",
        severity: "warning",
        timestamp: "2026-08-22T02:00:00.000Z",
        category: "code_defect",
        status: "resolved",
        observation: "Initial failure",
        remediation: "Fix in task",
        resolution: {
          task_id: "task-dedup-fix",
          test_assertion: "bun test tests/unit/dedup.test.ts",
          resolved_at: "2026-08-22T02:05:00.000Z",
        },
      };

      writeFileSync(
        join(capsuleDir, "defects.jsonl"),
        `${JSON.stringify(initialDefect)}\n${JSON.stringify(resolvedDefect)}\n`,
      );

      const report = auditDefectLog([capsuleDir]);
      expect(report.total_defects).toBe(1);
      expect(report.open_count).toBe(0);
      expect(report.resolved_count).toBe(1);
      expect(report.defects[0]?.status).toBe("resolved");
    });
  });

  describe("formulateDefectCandidates", () => {
    test("returns empty array when no defects provided", () => {
      expect(formulateDefectCandidates([], ["G1", "G2"])).toEqual([]);
    });

    test("generates candidate proposals only for open defects", () => {
      const defects: DefectEntry[] = [
        {
          id: "defect-open-1",
          type: "main_thread_direct_execution",
          severity: "critical",
          timestamp: "2026-08-22T01:00:00.000Z",
          category: "boundary_violation",
          status: "open",
          observation: "Direct execution without subagent",
          remediation: "Dispatch Tier 3 Implementer",
        },
        {
          id: "defect-resolved-2",
          type: "syntax_error",
          severity: "warning",
          timestamp: "2026-08-22T02:00:00.000Z",
          category: "code_defect",
          status: "resolved",
          observation: "Missing paren",
          remediation: "Add paren",
        },
        {
          id: "defect-open-3",
          type: "type_error",
          severity: "critical",
          timestamp: "2026-08-22T03:00:00.000Z",
          category: "code_defect",
          status: "open",
          observation: "Implicit any in module",
          remediation: "Add strict type annotations",
        },
      ];

      const proposals: MindCandidateProposal[] = formulateDefectCandidates(defects, ["G1", "G2"]);

      expect(proposals.length).toBe(2);

      const p1 = proposals[0];
      expect(p1 !== undefined).toBeTrue();
      if (p1 !== undefined) {
        expect(p1.id).toBe("cand-defect-open-1");
        expect(p1.kind).toBe("proposal");
        expect(p1.status).toBe("needs_authority");
        expect(p1.disposition).toBe("actionable");
        expect(p1.defect_id).toBe("defect-open-1");
        expect(p1.charter_goal_ids).toContain("G2");
      }

      const p2 = proposals[1];
      expect(p2 !== undefined).toBeTrue();
      if (p2 !== undefined) {
        expect(p2.id).toBe("cand-defect-open-3");
        expect(p2.kind).toBe("defect");
        expect(p2.charter_goal_ids).toContain("G1");
        expect(p2.statement).toContain("code defect");
      }
    });

    test("defaults charter goals when not provided", () => {
      const defect: DefectEntry = {
        id: "defect-no-charter",
        type: "instruction_drift",
        severity: "warning",
        timestamp: "2026-08-22T04:00:00.000Z",
        category: "model_reasoning_error",
        status: "open",
        observation: "Agent drifted from instructions",
        remediation: "Re-anchor against prompt",
      };

      const proposals = formulateDefectCandidates([defect], []);
      expect(proposals.length).toBe(1);
      expect(proposals[0]?.charter_goal_ids.length).toBeGreaterThan(0);
    });
  });

  describe("formatDefectAuditBrief", () => {
    test("formats concise Markdown brief for empty report", () => {
      const emptyReport: DefectAuditReport = {
        total_defects: 0,
        open_count: 0,
        resolved_count: 0,
        wontfix_count: 0,
        by_category: {
          code_defect: 0,
          model_reasoning_error: 0,
          boundary_violation: 0,
        },
        by_severity: {},
        defects: [],
        capsules_audited: ["/capsules/run-1"],
        generated_at: "2026-08-22T05:00:00.000Z",
      };

      const brief = formatDefectAuditBrief(emptyReport);
      expect(brief).toContain("### Defect Audit & Remediation Brief");
      expect(brief).toContain("Total Defects");
      expect(brief).toContain("No defect records detected");
    });

    test("formats table for populated defect report", () => {
      const report: DefectAuditReport = {
        total_defects: 2,
        open_count: 1,
        resolved_count: 1,
        wontfix_count: 0,
        by_category: {
          code_defect: 1,
          model_reasoning_error: 0,
          boundary_violation: 1,
        },
        by_severity: { critical: 1, warning: 1 },
        defects: [
          {
            id: "b-view-1",
            type: "main_thread_direct_execution",
            severity: "critical",
            timestamp: "2026-08-22T01:00:00.000Z",
            category: "boundary_violation",
            status: "open",
            observation: "Direct execution violation on main thread",
            remediation: "Dispatch Tier 3 worker",
          },
          {
            id: "b-view-2",
            type: "syntax_error",
            severity: "warning",
            timestamp: "2026-08-22T02:00:00.000Z",
            category: "code_defect",
            status: "resolved",
            observation: "Syntax defect",
            remediation: "Resolved syntax",
          },
        ],
        capsules_audited: ["/capsules/run-1"],
        generated_at: "2026-08-22T05:00:00.000Z",
      };

      const brief = formatDefectAuditBrief(report);
      expect(brief).toContain("Recorded Defects");
      expect(brief).toContain("`b-view-1`");
      expect(brief).toContain("⚠️ open");
      expect(brief).toContain("✅ resolved");
    });

    test("enforces line limits strictly", () => {
      const entries: DefectEntry[] = [];
      for (let i = 0; i < 50; i += 1) {
        entries.push({
          id: `defect-many-${i}`,
          type: "code_defect",
          severity: "warning",
          timestamp: "2026-08-22T00:00:00.000Z",
          category: "code_defect",
          status: "open",
          observation: `Defect number ${i}`,
          remediation: `Fix defect ${i}`,
        });
      }

      const report: DefectAuditReport = {
        total_defects: 50,
        open_count: 50,
        resolved_count: 0,
        wontfix_count: 0,
        by_category: {
          code_defect: 50,
          model_reasoning_error: 0,
          boundary_violation: 0,
        },
        by_severity: { warning: 50 },
        defects: entries,
        capsules_audited: ["/capsules/big-run"],
        generated_at: "2026-08-22T05:00:00.000Z",
      };

      const brief = formatDefectAuditBrief(report, { maxLines: 15 });
      const lineCount = brief.split("\n").length;
      expect(lineCount).toBeLessThanOrEqual(15);
      expect(brief).toContain("truncated");
    });
  });

  describe("validateResolutionProof", () => {
    test("validates complete resolution proof", () => {
      const proof = {
        task_id: "task-test-fix",
        test_assertion: "bun test tests/unit/proof.test.ts",
        resolved_at: "2026-08-22T05:00:00.000Z",
        commit_sha: "abc1234def",
      };
      const validated = validateResolutionProof(proof);
      expect(validated.task_id).toBe("task-test-fix");
      expect(validated.test_assertion).toBe("bun test tests/unit/proof.test.ts");
      expect(validated.commit_sha).toBe("abc1234def");
    });

    test("throws HarnessError on missing required fields", () => {
      expect(() => validateResolutionProof(null)).toThrow(HarnessError);
      expect(() => validateResolutionProof({ task_id: "" })).toThrow(HarnessError);
      expect(() =>
        validateResolutionProof({
          task_id: "task-1",
          test_assertion: "",
          resolved_at: "2026-08-22T00:00:00.000Z",
        }),
      ).toThrow(HarnessError);
    });

    test("enforces commit_sha when requireCommitSha is enabled", () => {
      const proof = {
        task_id: "task-test-fix",
        test_assertion: "bun test",
        resolved_at: "2026-08-22T05:00:00.000Z",
      };
      expect(() => validateResolutionProof(proof, { requireCommitSha: true })).toThrow(
        HarnessError,
      );
    });
  });

  describe("isDefectEligibleForPromotion", () => {
    test("returns true for resolved defect with valid proof", () => {
      const defect: DefectEntry = {
        id: "b-promo-1",
        type: "code_defect",
        severity: "warning",
        timestamp: "2026-08-22T00:00:00.000Z",
        status: "resolved",
        resolution: {
          task_id: "task-fix-1",
          test_assertion: "bun test",
          resolved_at: "2026-08-22T01:00:00.000Z",
          commit_sha: "c12345",
        },
      };
      expect(isDefectEligibleForPromotion(defect)).toBeTrue();
    });

    test("returns false for open or wontfix defects", () => {
      const openDefect: DefectEntry = {
        id: "b-open",
        type: "code_defect",
        severity: "warning",
        timestamp: "2026-08-22T00:00:00.000Z",
        status: "open",
      };
      expect(isDefectEligibleForPromotion(openDefect)).toBeFalse();
    });
  });

  describe("generateDefectRegressionTest and generateRegressionTestSuite", () => {
    test("generates valid regression test structure", () => {
      const defect: DefectEntry = {
        id: "defect-reg-1",
        type: "syntax_error",
        severity: "critical",
        timestamp: "2026-08-22T00:00:00.000Z",
        category: "code_defect",
        status: "resolved",
        observation: "Unmatched braces in config parser",
        remediation: "Add balanced brace validation",
        resolution: {
          task_id: "task-fix-parser",
          test_assertion: "bun test tests/unit/parser.test.ts",
          resolved_at: "2026-08-22T01:00:00.000Z",
        },
      };

      const generated = generateDefectRegressionTest(defect);
      expect(generated.defect_id).toBe("defect-reg-1");
      expect(generated.test_name).toContain("defect-reg-1");
      expect(generated.test_code).toContain("test(");
      expect(generated.test_code).toContain("expect(");

      const validation = validateRegressionTest(generated.test_code);
      expect(validation.isValid).toBeTrue();
    });

    test("generates regression test suite for multiple defects", () => {
      const defects: DefectEntry[] = [
        {
          id: "defect-suite-1",
          type: "code_defect",
          severity: "warning",
          timestamp: "2026-08-22T00:00:00.000Z",
          status: "resolved",
          observation: "Obs 1",
          remediation: "Remed 1",
          resolution: {
            task_id: "t1",
            test_assertion: "bun test",
            resolved_at: "2026-08-22T01:00:00.000Z",
          },
        },
        {
          id: "defect-suite-2",
          type: "boundary_violation",
          severity: "critical",
          timestamp: "2026-08-22T02:00:00.000Z",
          status: "resolved",
          observation: "Obs 2",
          remediation: "Remed 2",
          resolution: {
            task_id: "t2",
            test_assertion: "bun test",
            resolved_at: "2026-08-22T03:00:00.000Z",
          },
        },
      ];

      const suite = generateRegressionTestSuite(defects);
      expect(suite).toContain("describe(");
      expect(suite).toContain("Total defects protected: 2");
      expect(suite).toContain("defect-suite-1");
      expect(suite).toContain("defect-suite-2");
    });
  });

  describe("validateRegressionTest", () => {
    test("validates test code syntax and assertions", () => {
      const valid = 'test("passes", () => { expect(1).toBe(1); });';
      expect(validateRegressionTest(valid).isValid).toBeTrue();

      const invalidMismatchedBraces = 'test("broken", () => { expect(1).toBe(1);';
      expect(validateRegressionTest(invalidMismatchedBraces).isValid).toBeFalse();

      const noExpect = 'test("no assert", () => { console.log("noop"); });';
      expect(validateRegressionTest(noExpect).isValid).toBeFalse();
    });
  });

  describe("promoteResolvedDefects and autoPromoteDefect", () => {
    test("promotes resolved defects and separates remaining", () => {
      const testDir = createTempDir("defect-promo-");
      const targetPath = join(testDir, "COMPLETED_DEFECTS.jsonl");

      const defects: DefectEntry[] = [
        {
          id: "b-promo-res-1",
          type: "syntax_defect",
          severity: "warning",
          timestamp: "2026-08-22T00:00:00.000Z",
          status: "resolved",
          observation: "Syntax bug",
          remediation: "Fix bug",
          resolution: {
            task_id: "task-res-1",
            test_assertion: "bun test",
            resolved_at: "2026-08-22T01:00:00.000Z",
            commit_sha: "abc1",
          },
        },
        {
          id: "b-promo-open-2",
          type: "logic_error",
          severity: "critical",
          timestamp: "2026-08-22T00:30:00.000Z",
          status: "open",
        },
      ];

      const result = promoteResolvedDefects(defects, {
        targetPath,
        generateRegressionTests: true,
        updateSourceFile: false,
      });

      expect(result.promoted_count).toBe(1);
      expect(result.unpromoted_count).toBe(1);
      expect(result.promoted_defects[0]?.id).toBe("b-promo-res-1");
      expect(result.remaining_defects[0]?.id).toBe("b-promo-open-2");
      expect(result.generated_tests?.length).toBe(1);

      const completed = readCompletedDefectsLog(targetPath);
      expect(completed.length).toBe(1);
      expect(completed[0]?.id).toBe("b-promo-res-1");
    });

    test("autoPromoteDefect creates verified resolved entry and saves to target log", () => {
      const testDir = createTempDir("defect-autopromo-");
      const sourcePath = join(testDir, "defects.jsonl");
      const targetPath = join(testDir, "COMPLETED_DEFECTS.jsonl");

      const defect: DefectEntry = {
        id: "b-single-1",
        type: "code_defect",
        severity: "warning",
        timestamp: "2026-08-22T00:00:00.000Z",
        status: "open",
        observation: "Missing null check",
        remediation: "Add defensive guard",
      };

      writeFileSync(sourcePath, `${JSON.stringify(defect)}\n`);

      const result = autoPromoteDefect({
        id: "b-single-1",
        proof: {
          task_id: "task-null-guard",
          test_assertion: "bun test tests/unit/guard.test.ts",
          resolved_at: "2026-08-22T01:00:00.000Z",
          commit_sha: "csha123",
        },
        options: {
          sourcePath,
          targetPath,
        },
      });

      expect(result.promoted).toBeTrue();
      expect(result.defect.status).toBe("resolved");
      expect(result.defect.resolution?.task_id).toBe("task-null-guard");

      const completed = readCompletedDefectsLog(targetPath);
      expect(completed.length).toBe(1);
      expect(completed[0]?.id).toBe("b-single-1");
    });

    test("rejects invalid resolution without changing either defect ledger", () => {
      const testDir = createTempDir("defect-invalid-resolution-");
      const sourcePath = join(testDir, "defects.jsonl");
      const targetPath = join(testDir, "completed.jsonl");
      const sourceBytes =
        '{"id":"invalid-proof","status":"resolved","resolution":{"task_id":""},"unknown":{"preserve":true}}\n';
      const targetBytes = '{"id":"existing-completed","unknown":{"preserve":true}}\n';
      writeFileSync(sourcePath, sourceBytes, "utf8");
      writeFileSync(targetPath, targetBytes, "utf8");

      expect(() => promoteResolvedDefects({ sourcePath, targetPath })).toThrow(HarnessError);
      expect(readFileSync(sourcePath, "utf8")).toBe(sourceBytes);
      expect(readFileSync(targetPath, "utf8")).toBe(targetBytes);
    });
  });
});
