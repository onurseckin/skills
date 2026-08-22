import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import {
  auditBlunderLog,
  categorizeBlunder,
  formatBlunderAuditBrief,
  formulateBlunderCandidates,
  parseBlunderLog,
  resolveBlunder,
  serializeBlunderLog,
  type BlunderAuditReport,
  type BlunderCategory,
  type BlunderEntry,
  type BlunderResolutionProof,
  type MindCandidateProposal,
} from "../../../orchestrating-long-tasks/scripts/src/mind/blunders.ts";

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

describe("Core Blunder Categorization & Resolution Tracking Engine", () => {
  describe("categorizeBlunder", () => {
    test("preserves existing valid categories", () => {
      const b1 = { category: "code_defect" };
      const b2 = { category: "model_reasoning_error" };
      const b3 = { category: "boundary_violation" };

      expect(categorizeBlunder(b1)).toBe("code_defect");
      expect(categorizeBlunder(b2)).toBe("model_reasoning_error");
      expect(categorizeBlunder(b3)).toBe("boundary_violation");
    });

    test("categorizes boundary violations from type keywords", () => {
      expect(categorizeBlunder({ type: "main_thread_direct_execution" })).toBe("boundary_violation");
      expect(categorizeBlunder({ type: "main_thread_boundary_violation" })).toBe("boundary_violation");
      expect(categorizeBlunder({ type: "role_escalation" })).toBe("boundary_violation");
      expect(categorizeBlunder({ type: "unauthorized_mutation" })).toBe("boundary_violation");
      expect(categorizeBlunder({ type: "restraint_violation" })).toBe("boundary_violation");
      expect(categorizeBlunder({ type: "thread_authority_breach" })).toBe("boundary_violation");
      expect(categorizeBlunder({ type: "tier_escaped" })).toBe("boundary_violation");
      expect(categorizeBlunder({ type: "permission_denied" })).toBe("boundary_violation");
    });

    test("categorizes boundary violations from observation or remediation text", () => {
      const entry = {
        type: "unknown_event",
        observation: "Main thread attempted direct file write without subagent boundary delegation",
        remediation: "Dispatch Tier 3 Implementer via invoke_subagent",
      };
      expect(categorizeBlunder(entry)).toBe("boundary_violation");

      const entry2 = {
        type: "guard_alert",
        observation: "Execution detected under Tier 0 human shell trying automated mutation",
        remediation: "Enforce thread restraint active",
      };
      expect(categorizeBlunder(entry2)).toBe("boundary_violation");
    });

    test("categorizes model reasoning errors from type or description", () => {
      expect(categorizeBlunder({ type: "hallucination_detected" })).toBe("model_reasoning_error");
      expect(categorizeBlunder({ type: "plan_drift" })).toBe("model_reasoning_error");
      expect(categorizeBlunder({ type: "intent_drift" })).toBe("model_reasoning_error");
      expect(categorizeBlunder({ type: "instruction_drift" })).toBe("model_reasoning_error");
      expect(categorizeBlunder({ type: "self_critique_failure" })).toBe("model_reasoning_error");
      expect(categorizeBlunder({ type: "context_loss" })).toBe("model_reasoning_error");

      const entry = {
        type: "planner_error",
        observation: "Model made an incorrect premise regarding state file schema",
        remediation: "Perform re-reading and self-audit before planning",
      };
      expect(categorizeBlunder(entry)).toBe("model_reasoning_error");

      const entry2 = {
        type: "anomaly",
        observation: "Agent produced an illogical decision contradicting requirements",
        remediation: "Address reasoning error with counterfactual check",
      };
      expect(categorizeBlunder(entry2)).toBe("model_reasoning_error");
    });

    test("defaults other defects to code_defect", () => {
      expect(categorizeBlunder({ type: "syntax_error" })).toBe("code_defect");
      expect(categorizeBlunder({ type: "type_error" })).toBe("code_defect");
      expect(categorizeBlunder({ type: "test_failure" })).toBe("code_defect");
      expect(categorizeBlunder({ type: "failing_gate" })).toBe("code_defect");
      expect(categorizeBlunder({ type: "runtime_error" })).toBe("code_defect");
      expect(categorizeBlunder({})).toBe("code_defect");
      expect(categorizeBlunder({ type: "unrecognized" })).toBe("code_defect");
    });
  });

  describe("parseBlunderLog", () => {
    test("returns empty array for empty or whitespace content", () => {
      expect(parseBlunderLog("")).toEqual([]);
      expect(parseBlunderLog("   \n\n  \t ")).toEqual([]);
    });

    test("parses single and multiple valid JSONL blunder lines", () => {
      const b1 = {
        id: "blunder-1",
        type: "main_thread_direct_execution",
        severity: "critical",
        timestamp: "2026-08-22T00:00:00.000Z",
        observation: "Main thread executed task directly",
        remediation: "Dispatch Tier 3 Implementer",
      };
      const b2 = {
        id: "blunder-2",
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
      const parsed = parseBlunderLog(jsonl, { capsuleRoot: "/tmp/capsule-1" });

      expect(parsed.length).toBe(2);

      const entry1 = parsed[0];
      expect(entry1 !== undefined).toBeTrue();
      if (entry1 !== undefined) {
        expect(entry1.id).toBe("blunder-1");
        expect(entry1.category).toBe("boundary_violation");
        expect(entry1.status).toBe("open");
        expect(entry1.capsule_root).toBe("/tmp/capsule-1");
        expect(entry1.resolution).toBeUndefined();
      }

      const entry2 = parsed[1];
      expect(entry2 !== undefined).toBeTrue();
      if (entry2 !== undefined) {
        expect(entry2.id).toBe("blunder-2");
        expect(entry2.category).toBe("code_defect");
        expect(entry2.status).toBe("resolved");
        expect(entry2.resolution?.task_id).toBe("task-fix-syntax");
        expect(entry2.resolution?.commit_sha).toBe("abc1234");
      }
    });

    test("skips malformed JSON and non-object lines gracefully", () => {
      const content = [
        "not valid json",
        JSON.stringify({ id: "valid-1", type: "lint_error", observation: "Unused var" }),
        "42",
        "null",
        JSON.stringify({ id: "valid-2", type: "logic_error", observation: "Reasoning error in calculation" }),
      ].join("\n");

      const parsed = parseBlunderLog(content);
      expect(parsed.length).toBe(2);
      expect(parsed[0]?.id).toBe("valid-1");
      expect(parsed[1]?.id).toBe("valid-2");
      expect(parsed[1]?.category).toBe("model_reasoning_error");
    });

    test("handles null resolution cleanly", () => {
      const content = JSON.stringify({
        id: "blunder-null-res",
        type: "type_error",
        status: "open",
        resolution: null,
      });

      const parsed = parseBlunderLog(content);
      expect(parsed.length).toBe(1);
      expect(parsed[0]?.resolution).toBeNull();
    });
  });

  describe("serializeBlunderLog", () => {
    test("returns empty string for empty inputs", () => {
      expect(serializeBlunderLog([])).toBe("");
    });

    test("serializes blunder records into valid JSONL", () => {
      const entries: BlunderEntry[] = [
        {
          id: "blunder-s1",
          type: "role_escalation",
          severity: "critical",
          timestamp: "2026-08-22T04:00:00.000Z",
          category: "boundary_violation",
          status: "open",
          observation: "Unauthorized lease acquisition",
          remediation: "Revoke lease",
        },
        {
          id: "blunder-s2",
          type: "hallucination_detected",
          severity: "warning",
          timestamp: "2026-08-22T04:30:00.000Z",
          category: "model_reasoning_error",
          status: "wontfix",
          observation: "Fabricated API parameter",
          remediation: "Review schema documentation",
        },
      ];

      const serialized = serializeBlunderLog(entries);
      expect(serialized.endsWith("\n")).toBeTrue();

      const roundTrip = parseBlunderLog(serialized);
      expect(roundTrip.length).toBe(2);
      expect(roundTrip[0]?.id).toBe("blunder-s1");
      expect(roundTrip[0]?.category).toBe("boundary_violation");
      expect(roundTrip[1]?.id).toBe("blunder-s2");
      expect(roundTrip[1]?.status).toBe("wontfix");
    });
  });

  describe("resolveBlunder", () => {
    const sampleBlunder: BlunderEntry = {
      id: "blunder-r1",
      type: "unauthorized_mutation",
      severity: "critical",
      timestamp: "2026-08-22T05:00:00.000Z",
      category: "boundary_violation",
      status: "open",
      observation: "Direct edit on main branch",
      remediation: "Isolate to task workspace branch",
    };

    test("successfully resolves blunder with valid proof", () => {
      const proof: BlunderResolutionProof = {
        task_id: "task-auth-fix",
        test_assertion: "bun test tests/unit/auth.test.ts",
        resolved_at: "2026-08-22T05:15:00.000Z",
        commit_sha: "commit-998877",
      };

      const resolved = resolveBlunder(sampleBlunder, proof);

      expect(resolved.status).toBe("resolved");
      expect(resolved.resolution?.task_id).toBe("task-fix" ? "task-auth-fix" : "task-auth-fix");
      expect(resolved.resolution?.test_assertion).toBe("bun test tests/unit/auth.test.ts");
      expect(resolved.resolution?.resolved_at).toBe("2026-08-22T05:15:00.000Z");
      expect(resolved.resolution?.commit_sha).toBe("commit-998877");
      expect(resolved.id).toBe(sampleBlunder.id);
      expect(sampleBlunder.status).toBe("open"); // Immutable
    });

    test("throws HarnessError on invalid or missing proof fields", () => {
      const invalidProof1 = {
        task_id: "",
        test_assertion: "bun test",
        resolved_at: "2026-08-22T05:15:00.000Z",
      };
      expect(() => resolveBlunder(sampleBlunder, invalidProof1)).toThrow(HarnessError);

      const invalidProof2 = {
        task_id: "task-1",
        test_assertion: "   ",
        resolved_at: "2026-08-22T05:15:00.000Z",
      };
      expect(() => resolveBlunder(sampleBlunder, invalidProof2)).toThrow(HarnessError);

      const invalidProof3 = {
        task_id: "task-1",
        test_assertion: "bun test",
        resolved_at: "",
      };
      expect(() => resolveBlunder(sampleBlunder, invalidProof3)).toThrow(HarnessError);
    });
  });

  describe("auditBlunderLog", () => {
    test("handles empty capsule roots list", () => {
      const report = auditBlunderLog([]);
      expect(report.total_blunders).toBe(0);
      expect(report.open_count).toBe(0);
      expect(report.resolved_count).toBe(0);
      expect(report.wontfix_count).toBe(0);
      expect(report.blunders).toEqual([]);
      expect(report.capsules_audited).toEqual([]);
    });

    test("audits blunders across multiple capsules and aggregates counts", () => {
      const testDir = createTempDir("blunder-audit-test-");

      const capsule1 = join(testDir, "capsule-1");
      const capsule2 = join(testDir, "capsule-2");
      mkdirSync(capsule1, { recursive: true });
      mkdirSync(capsule2, { recursive: true });

      const blunderA: BlunderEntry = {
        id: "b-1",
        type: "main_thread_direct_execution",
        severity: "critical",
        timestamp: "2026-08-22T01:00:00.000Z",
        category: "boundary_violation",
        status: "open",
        observation: "Main thread edit",
        remediation: "Delegate to worker",
      };

      const blunderB: BlunderEntry = {
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

      const blunderC: BlunderEntry = {
        id: "b-3",
        type: "syntax_defect",
        severity: "warning",
        timestamp: "2026-08-22T04:00:00.000Z",
        category: "code_defect",
        status: "wontfix",
        observation: "Legacy artifact syntax",
        remediation: "Ignore legacy file",
      };

      writeFileSync(join(capsule1, "blunders.jsonl"), `${JSON.stringify(blunderA)}\n${JSON.stringify(blunderB)}\n`);
      writeFileSync(join(capsule2, "blunders.jsonl"), `${JSON.stringify(blunderC)}\n`);

      const report: BlunderAuditReport = auditBlunderLog([capsule1, capsule2]);

      expect(report.total_blunders).toBe(3);
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

    test("deduplicates blunders by ID and prioritizes resolved status updates", () => {
      const testDir = createTempDir("blunder-dedup-test-");
      const capsuleDir = join(testDir, "capsule-main");
      mkdirSync(capsuleDir, { recursive: true });

      const initialBlunder: BlunderEntry = {
        id: "b-dedup-1",
        type: "code_defect",
        severity: "warning",
        timestamp: "2026-08-22T01:00:00.000Z",
        category: "code_defect",
        status: "open",
        observation: "Initial failure",
        remediation: "Fix in task",
      };

      const resolvedBlunder: BlunderEntry = {
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
        join(capsuleDir, "blunders.jsonl"),
        `${JSON.stringify(initialBlunder)}\n${JSON.stringify(resolvedBlunder)}\n`,
      );

      const report = auditBlunderLog([capsuleDir]);
      expect(report.total_blunders).toBe(1);
      expect(report.open_count).toBe(0);
      expect(report.resolved_count).toBe(1);
      expect(report.blunders[0]?.status).toBe("resolved");
    });
  });

  describe("formulateBlunderCandidates", () => {
    test("returns empty array when no blunders provided", () => {
      expect(formulateBlunderCandidates([], ["G1", "G2"])).toEqual([]);
    });

    test("generates candidate proposals only for open blunders", () => {
      const blunders: BlunderEntry[] = [
        {
          id: "blunder-open-1",
          type: "main_thread_direct_execution",
          severity: "critical",
          timestamp: "2026-08-22T01:00:00.000Z",
          category: "boundary_violation",
          status: "open",
          observation: "Direct execution without subagent",
          remediation: "Dispatch Tier 3 Implementer",
        },
        {
          id: "blunder-resolved-2",
          type: "syntax_error",
          severity: "warning",
          timestamp: "2026-08-22T02:00:00.000Z",
          category: "code_defect",
          status: "resolved",
          observation: "Missing paren",
          remediation: "Add paren",
        },
        {
          id: "blunder-open-3",
          type: "type_error",
          severity: "critical",
          timestamp: "2026-08-22T03:00:00.000Z",
          category: "code_defect",
          status: "open",
          observation: "Implicit any in module",
          remediation: "Add strict type annotations",
        },
      ];

      const proposals: MindCandidateProposal[] = formulateBlunderCandidates(blunders, ["G1", "G2"]);

      expect(proposals.length).toBe(2);

      const p1 = proposals[0];
      expect(p1 !== undefined).toBeTrue();
      if (p1 !== undefined) {
        expect(p1.id).toBe("cand-blunder-open-1");
        expect(p1.kind).toBe("proposal");
        expect(p1.status).toBe("needs_authority");
        expect(p1.disposition).toBe("actionable");
        expect(p1.blunder_id).toBe("blunder-open-1");
        expect(p1.charter_goal_ids).toContain("G2");
      }

      const p2 = proposals[1];
      expect(p2 !== undefined).toBeTrue();
      if (p2 !== undefined) {
        expect(p2.id).toBe("cand-blunder-open-3");
        expect(p2.kind).toBe("defect");
        expect(p2.charter_goal_ids).toContain("G1");
        expect(p2.statement).toContain("code defect");
      }
    });

    test("defaults charter goals when not provided", () => {
      const blunder: BlunderEntry = {
        id: "blunder-no-charter",
        type: "instruction_drift",
        severity: "warning",
        timestamp: "2026-08-22T04:00:00.000Z",
        category: "model_reasoning_error",
        status: "open",
        observation: "Agent drifted from instructions",
        remediation: "Re-anchor against prompt",
      };

      const proposals = formulateBlunderCandidates([blunder], []);
      expect(proposals.length).toBe(1);
      expect(proposals[0]?.charter_goal_ids.length).toBeGreaterThan(0);
    });
  });

  describe("formatBlunderAuditBrief", () => {
    test("formats concise Markdown brief for empty report", () => {
      const emptyReport: BlunderAuditReport = {
        total_blunders: 0,
        open_count: 0,
        resolved_count: 0,
        wontfix_count: 0,
        by_category: { code_defect: 0, model_reasoning_error: 0, boundary_violation: 0 },
        by_severity: {},
        blunders: [],
        capsules_audited: ["/capsules/run-1"],
        generated_at: "2026-08-22T05:00:00.000Z",
      };

      const brief = formatBlunderAuditBrief(emptyReport);
      expect(brief).toContain("### Blunder Audit & Remediation Brief");
      expect(brief).toContain("Total Blunders");
      expect(brief).toContain("No blunder records detected");
    });

    test("formats table for populated blunder report", () => {
      const report: BlunderAuditReport = {
        total_blunders: 2,
        open_count: 1,
        resolved_count: 1,
        wontfix_count: 0,
        by_category: { code_defect: 1, model_reasoning_error: 0, boundary_violation: 1 },
        by_severity: { critical: 1, warning: 1 },
        blunders: [
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

      const brief = formatBlunderAuditBrief(report);
      expect(brief).toContain("Recorded Blunders");
      expect(brief).toContain("`b-view-1`");
      expect(brief).toContain("⚠️ open");
      expect(brief).toContain("✅ resolved");
    });

    test("enforces line limits strictly", () => {
      const entries: BlunderEntry[] = [];
      for (let i = 0; i < 50; i += 1) {
        entries.push({
          id: `blunder-many-${i}`,
          type: "code_defect",
          severity: "warning",
          timestamp: "2026-08-22T00:00:00.000Z",
          category: "code_defect",
          status: "open",
          observation: `Defect number ${i}`,
          remediation: `Fix defect ${i}`,
        });
      }

      const report: BlunderAuditReport = {
        total_blunders: 50,
        open_count: 50,
        resolved_count: 0,
        wontfix_count: 0,
        by_category: { code_defect: 50, model_reasoning_error: 0, boundary_violation: 0 },
        by_severity: { warning: 50 },
        blunders: entries,
        capsules_audited: ["/capsules/big-run"],
        generated_at: "2026-08-22T05:00:00.000Z",
      };

      const brief = formatBlunderAuditBrief(report, { maxLines: 15 });
      const lineCount = brief.split("\n").length;
      expect(lineCount).toBeLessThanOrEqual(15);
      expect(brief).toContain("truncated");
    });
  });
});
