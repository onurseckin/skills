import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditDefectLog,
  categorizeDefect,
  createDefectDeliberationRound,
  formatDefectAuditBrief,
  formulateDefectCandidates,
  formulateBoundaryViolationHypothesis,
  generateDefectRegressionTest,
  generateRegressionTestSuite,
  isDefectEligibleForPromotion,
  parseDefectLog,
  resolveDefect,
  serializeDefectLog,
  synthesizeBoundaryRemediationActions,
  synthesizeDeliberationRound,
  synthesizeRemediationActions,
  validateRegressionTest,
  validateResolutionProof,
  verifyResolutionProofEmpirical,
  type DefectCategory,
  type DefectEntry,
  type DefectResolutionProof,
} from "../../../olt/scripts/src/mind/defects.ts";
import { GLOBAL_SYNC_GEN5 } from "../../../scripts/sync-global.ts";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
  tempRoots.length = 0;
});

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

describe("Defect Remediation 46: Archival, Classification, and Empirical Verification", () => {
  // Load defects from .capsules/defects.jsonl
  const defectsFilePath = join(process.cwd(), ".olt", "capsules", "defects.jsonl");
  const rawDefectsContent = existsSync(defectsFilePath)
    ? readFileSync(defectsFilePath, "utf8")
    : "";
  const allDefects: readonly DefectEntry[] = parseDefectLog(rawDefectsContent);

  describe("Dataset Ingestion & Archival Integrity", () => {
    test("successfully parses all defect instances from .capsules/defects.jsonl", () => {
      expect(allDefects.length).toBeGreaterThanOrEqual(46);
    });

    test("every defect instance has a distinct non-empty ID", () => {
      const ids = allDefects.map((b) => b.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(allDefects.length);
      for (const id of ids) {
        expect(id).toBeDefined();
        expect(id.trim().length).toBeGreaterThan(0);
      }
    });

    test("every defect instance has a valid ISO timestamp", () => {
      for (const defect of allDefects) {
        expect(defect.timestamp).toBeDefined();
        const parsed = Date.parse(defect.timestamp);
        expect(Number.isFinite(parsed)).toBe(true);
      }
    });

    test("every defect instance has non-empty observation and remediation instructions", () => {
      for (const defect of allDefects) {
        expect(defect.observation).toBeDefined();
        expect(defect.observation.trim().length).toBeGreaterThan(0);

        expect(defect.remediation).toBeDefined();
        expect(defect.remediation.trim().length).toBeGreaterThan(0);
      }
    });

    test("roundtrip serialization preserves all defect instances and metadata without corruption", () => {
      const serialized = serializeDefectLog(allDefects);
      expect(serialized).toBeDefined();
      expect(serialized.trim().length).toBeGreaterThan(0);

      const reparsed = parseDefectLog(serialized);
      expect(reparsed.length).toBe(allDefects.length);

      for (let i = 0; i < allDefects.length; i++) {
        const original = allDefects[i]!;
        const roundtripped = reparsed[i]!;
        expect(roundtripped.id).toBe(original.id);
        expect(roundtripped.type).toBe(original.type);
        expect(roundtripped.severity).toBe(original.severity);
        expect(roundtripped.timestamp).toBe(original.timestamp);
        expect(roundtripped.observation).toBe(original.observation);
        expect(roundtripped.remediation).toBe(original.remediation);
      }
    });
  });

  describe("Taxonomy & Invariant Categorization", () => {
    test("categorizes every defect instance into valid DefectCategory", () => {
      const validCategories = new Set<DefectCategory>([
        "boundary_violation",
        "code_defect",
        "model_reasoning_error",
      ]);

      for (const defect of allDefects) {
        const category = categorizeDefect(defect);
        expect(validCategories.has(category)).toBe(true);
      }
    });

    test("accurately classifies main_thread_direct_execution and coordinator_code_writing as boundary violations", () => {
      const mainThreadDefects = allDefects.filter((b) => b.type === "main_thread_direct_execution");
      expect(mainThreadDefects.length).toBeGreaterThanOrEqual(45);
      for (const defect of mainThreadDefects) {
        expect(categorizeDefect(defect)).toBe("boundary_violation");
      }

      const coordWritingDefects = allDefects.filter((b) => b.type === "coordinator_code_writing");
      expect(coordWritingDefects.length).toBeGreaterThanOrEqual(1);
      for (const defect of coordWritingDefects) {
        expect(categorizeDefect(defect)).toBe("boundary_violation");
        expect(defect.role).toBe("coordinator");
      }
    });

    test("every defect instance has critical severity assigned", () => {
      for (const defect of allDefects) {
        expect(defect.severity).toBe("critical");
      }
    });
  });

  describe("Remediation Invariants & Prescriptions", () => {
    test("verifies main thread direct execution remediation mandates subagent delegation", () => {
      const mainThreadDefects = allDefects.filter((b) => b.type === "main_thread_direct_execution");
      for (const defect of mainThreadDefects) {
        expect(defect.remediation).toContain("invoke_subagent");
        expect(defect.remediation).toContain(
          "Tier 2 Background Coordinators or Tier 3 Implementers",
        );
      }
    });

    test("verifies coordinator code writing remediation enforces Zero Coordinator Code Writing invariant", () => {
      const coordWritingDefects = allDefects.filter((b) => b.type === "coordinator_code_writing");
      for (const defect of coordWritingDefects) {
        expect(defect.observation).toContain("Zero-Tolerance Invariant Breached");
        expect(defect.remediation).toContain("Coordinators must never write code");
        expect(defect.remediation).toContain("Tier 3 Implementers");
      }
    });
  });

  describe("Hypothesis Formulation & Remediation Action Synthesis", () => {
    test("formulates high-confidence boundary violation hypotheses for all defect instances", () => {
      for (const defect of allDefects) {
        const hypothesis = formulateBoundaryViolationHypothesis(defect);
        expect(hypothesis.defect_id).toBe(defect.id);
        expect(hypothesis.category).toBe("boundary_violation");
        expect(hypothesis.confidence).toBeGreaterThanOrEqual(0.9);
        expect(hypothesis.root_cause.length).toBeGreaterThan(0);
        expect(hypothesis.evidence.length).toBeGreaterThan(0);
      }
    });

    test("synthesizes actionable remediation steps with test gate specifications", () => {
      const hypotheses = allDefects.map((b) => formulateBoundaryViolationHypothesis(b));
      const actions = synthesizeBoundaryRemediationActions(hypotheses, allDefects);
      expect(actions.length).toBeGreaterThanOrEqual(allDefects.length);
      for (const action of actions) {
        expect(action.defect_id.length).toBeGreaterThan(0);
        expect(["tighten_boundary", "add_test_gate", "update_invariants"]).toContain(
          action.action_type,
        );
        expect(action.description.length).toBeGreaterThan(0);
        expect(action.prescribed_test.length).toBeGreaterThan(0);
        expect(action.target_scope.length).toBeGreaterThan(0);
      }
    });

    test("constructs deliberation round and remediation synthesis across all defects", () => {
      const round = createDefectDeliberationRound({
        round_number: 1,
        capsule_root: process.cwd(),
        defects: allDefects,
      });

      expect(round.round_number).toBe(1);
      expect(round.hypotheses.length).toBe(allDefects.length);
      expect(round.remediation_actions.length).toBeGreaterThan(0);
      expect(round.synthesis).toBeDefined();
      expect(round.synthesis.unresolved_defect_ids.length).toBe(allDefects.length);
    });
  });

  describe("Regression Test Generation & Assertion Hardening", () => {
    test("generates syntactically valid regression test cases for every defect instance", () => {
      for (const defect of allDefects) {
        const generated = generateDefectRegressionTest(defect, {
          includeComments: true,
        });

        expect(generated.defect_id).toBe(defect.id);
        expect(generated.test_name).toContain(defect.id);
        expect(generated.file_path_hint).toBe("tests/unit/mind/boundary-regression.test.ts");
        expect(generated.category).toBe("boundary_violation");
        expect(generated.verified_assertion.length).toBeGreaterThan(0);

        const validation = validateRegressionTest(
          `import { describe, expect, test } from "bun:test";\ndescribe("test-suite", () => {\n${generated.test_code}\n});`,
        );
        expect(validation.isValid).toBe(true);
        expect(validation.issues).toHaveLength(0);
      }
    });

    test("generates complete regression test suite spanning all defect instances", () => {
      const suiteCode = generateRegressionTestSuite(allDefects, {
        suiteName: "46+ Defect Remediation Master Regression Suite",
        bannerTitle: "Comprehensive Historical Defect Protection Suite",
      });

      expect(suiteCode).toContain("46+ Defect Remediation Master Regression Suite");
      expect(suiteCode).toContain("Comprehensive Historical Defect Protection Suite");
      expect(suiteCode).toContain(`Total defects protected: ${allDefects.length}`);

      const validation = validateRegressionTest(suiteCode);
      expect(validation.isValid).toBe(true);
      expect(validation.issues).toHaveLength(0);
    });
  });

  describe("Resolution Proof Formulation & Empirical Verification", () => {
    test("validates empirical resolution proofs for all 46+ defect instances", () => {
      for (let i = 0; i < allDefects.length; i++) {
        const defect = allDefects[i]!;
        const proof: DefectResolutionProof = {
          task_id: `task-remediate-${defect.id}`,
          test_assertion: `expect(isBoundaryConcurred).toBeTrue() // defect ${defect.id}`,
          resolved_at: new Date().toISOString(),
          commit_sha: "a1b2c3d4e5f678901234567890abcdef12345678",
          remediation_notes: `Remediated defect ${defect.id} via subagent enforcement`,
          verified_by: "test-verifier",
        };

        const validated = validateResolutionProof(proof, { requireCommitSha: true });
        expect(validated.task_id).toBe(proof.task_id);
        expect(validated.test_assertion).toBe(proof.test_assertion);
        expect(validated.commit_sha).toBe(proof.commit_sha);

        const empirical = verifyResolutionProofEmpirical(proof, { requireCommitSha: true });
        expect(empirical.isValid).toBe(true);
        expect(empirical.reason).toBeUndefined();
      }
    });

    test("resolving all defect instances transitions status to resolved and passes promotion eligibility", () => {
      for (const defect of allDefects) {
        const proof: DefectResolutionProof = {
          task_id: `task-remediate-${defect.id}`,
          test_assertion: `verifyBoundaryConfinement("${defect.id}") === true`,
          resolved_at: new Date().toISOString(),
          commit_sha: "1234567890abcdef1234567890abcdef12345678",
        };

        const resolved = resolveDefect(defect, proof);
        expect(resolved.status).toBe("resolved");
        expect(resolved.resolution).toEqual(proof);

        const eligible = isDefectEligibleForPromotion(resolved, { requireCommitSha: true });
        expect(eligible).toBe(true);
      }
    });

    test("formulates candidate proposals from open defects for self-evolution planning", () => {
      const candidates = formulateDefectCandidates(allDefects);
      expect(candidates.length).toBe(allDefects.length);
      for (const candidate of candidates) {
        expect(candidate.kind).toBe("proposal");
        expect(candidate.defect_id).toBeDefined();
        expect(candidate.statement.length).toBeGreaterThan(0);
        expect(candidate.rationale.length).toBeGreaterThan(0);
        expect(candidate.write_scope.length).toBeGreaterThan(0);
        expect(candidate.charter_goal_ids.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Capsule Audit Report Synthesis", () => {
    test("generates comprehensive audit report across test workspace", () => {
      const tempDir = createTempDir("defect-audit-test-");
      const capsuleDir = join(tempDir, ".olt");
      mkdirSync(capsuleDir, { recursive: true });

      const logPath = join(capsuleDir, "defects.jsonl");
      writeFileSync(logPath, serializeDefectLog(allDefects), "utf8");

      const report = auditDefectLog([tempDir]);
      expect(report.total_defects).toBe(allDefects.length);
      expect(report.open_count).toBe(allDefects.length);
      expect(report.resolved_count).toBe(0);
      expect(report.by_category.boundary_violation).toBe(allDefects.length);
      expect(report.by_severity.critical).toBe(allDefects.length);

      const brief = formatDefectAuditBrief(report);
      expect(brief).toContain("Defect Audit & Remediation Brief");
      expect(brief).toContain(`Total Defects**: \`${allDefects.length}\``);
      expect(brief).toContain(`boundary_violation: ${allDefects.length}`);
    });

    test("verifies global skill sync module exports Gen5 status", () => {
      expect(GLOBAL_SYNC_GEN5).toBe(true);
    });
  });
});
