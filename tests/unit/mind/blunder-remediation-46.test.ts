import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditBlunderLog,
  categorizeBlunder,
  createBlunderDeliberationRound,
  formatBlunderAuditBrief,
  formulateBlunderCandidates,
  formulateBoundaryViolationHypothesis,
  generateBlunderRegressionTest,
  generateRegressionTestSuite,
  isBlunderEligibleForPromotion,
  parseBlunderLog,
  resolveBlunder,
  serializeBlunderLog,
  synthesizeBoundaryRemediationActions,
  synthesizeDeliberationRound,
  synthesizeRemediationActions,
  validateRegressionTest,
  validateResolutionProof,
  verifyResolutionProofEmpirical,
  type BlunderCategory,
  type BlunderEntry,
  type BlunderResolutionProof,
} from "../../../orchestrating-long-tasks/scripts/src/mind/blunders.ts";
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

describe("Blunder Remediation 46: Archival, Classification, and Empirical Verification", () => {
  // Load blunders from .capsules/blunders.jsonl
  const blundersFilePath = join(process.cwd(), ".capsules", "blunders.jsonl");
  const rawBlundersContent = existsSync(blundersFilePath)
    ? readFileSync(blundersFilePath, "utf8")
    : "";
  const allBlunders: readonly BlunderEntry[] = parseBlunderLog(rawBlundersContent);

  describe("Dataset Ingestion & Archival Integrity", () => {
    test("successfully parses all blunder instances from .capsules/blunders.jsonl", () => {
      expect(allBlunders.length).toBeGreaterThanOrEqual(46);
    });

    test("every blunder instance has a distinct non-empty ID", () => {
      const ids = allBlunders.map((b) => b.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(allBlunders.length);
      for (const id of ids) {
        expect(id).toBeDefined();
        expect(id.trim().length).toBeGreaterThan(0);
      }
    });

    test("every blunder instance has a valid ISO timestamp", () => {
      for (const blunder of allBlunders) {
        expect(blunder.timestamp).toBeDefined();
        const parsed = Date.parse(blunder.timestamp);
        expect(Number.isFinite(parsed)).toBe(true);
      }
    });

    test("every blunder instance has non-empty observation and remediation instructions", () => {
      for (const blunder of allBlunders) {
        expect(blunder.observation).toBeDefined();
        expect(blunder.observation.trim().length).toBeGreaterThan(0);

        expect(blunder.remediation).toBeDefined();
        expect(blunder.remediation.trim().length).toBeGreaterThan(0);
      }
    });

    test("roundtrip serialization preserves all blunder instances and metadata without corruption", () => {
      const serialized = serializeBlunderLog(allBlunders);
      expect(serialized).toBeDefined();
      expect(serialized.trim().length).toBeGreaterThan(0);

      const reparsed = parseBlunderLog(serialized);
      expect(reparsed.length).toBe(allBlunders.length);

      for (let i = 0; i < allBlunders.length; i++) {
        const original = allBlunders[i]!;
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
    test("categorizes every blunder instance into valid BlunderCategory", () => {
      const validCategories = new Set<BlunderCategory>([
        "boundary_violation",
        "code_defect",
        "model_reasoning_error",
      ]);

      for (const blunder of allBlunders) {
        const category = categorizeBlunder(blunder);
        expect(validCategories.has(category)).toBe(true);
      }
    });

    test("accurately classifies main_thread_direct_execution and coordinator_code_writing as boundary violations", () => {
      const mainThreadBlunders = allBlunders.filter(
        (b) => b.type === "main_thread_direct_execution",
      );
      expect(mainThreadBlunders.length).toBeGreaterThanOrEqual(45);
      for (const blunder of mainThreadBlunders) {
        expect(categorizeBlunder(blunder)).toBe("boundary_violation");
      }

      const coordWritingBlunders = allBlunders.filter((b) => b.type === "coordinator_code_writing");
      expect(coordWritingBlunders.length).toBeGreaterThanOrEqual(1);
      for (const blunder of coordWritingBlunders) {
        expect(categorizeBlunder(blunder)).toBe("boundary_violation");
        expect(blunder.role).toBe("coordinator");
      }
    });

    test("every blunder instance has critical severity assigned", () => {
      for (const blunder of allBlunders) {
        expect(blunder.severity).toBe("critical");
      }
    });
  });

  describe("Remediation Invariants & Prescriptions", () => {
    test("verifies main thread direct execution remediation mandates subagent delegation", () => {
      const mainThreadBlunders = allBlunders.filter(
        (b) => b.type === "main_thread_direct_execution",
      );
      for (const blunder of mainThreadBlunders) {
        expect(blunder.remediation).toContain("invoke_subagent");
        expect(blunder.remediation).toContain(
          "Tier 2 Background Coordinators or Tier 3 Implementers",
        );
      }
    });

    test("verifies coordinator code writing remediation enforces Zero Coordinator Code Writing invariant", () => {
      const coordWritingBlunders = allBlunders.filter((b) => b.type === "coordinator_code_writing");
      for (const blunder of coordWritingBlunders) {
        expect(blunder.observation).toContain("Zero-Tolerance Invariant Breached");
        expect(blunder.remediation).toContain("Coordinators must never write code");
        expect(blunder.remediation).toContain("Tier 3 Implementers");
      }
    });
  });

  describe("Hypothesis Formulation & Remediation Action Synthesis", () => {
    test("formulates high-confidence boundary violation hypotheses for all blunder instances", () => {
      for (const blunder of allBlunders) {
        const hypothesis = formulateBoundaryViolationHypothesis(blunder);
        expect(hypothesis.blunder_id).toBe(blunder.id);
        expect(hypothesis.category).toBe("boundary_violation");
        expect(hypothesis.confidence).toBeGreaterThanOrEqual(0.9);
        expect(hypothesis.root_cause.length).toBeGreaterThan(0);
        expect(hypothesis.evidence.length).toBeGreaterThan(0);
      }
    });

    test("synthesizes actionable remediation steps with test gate specifications", () => {
      const hypotheses = allBlunders.map((b) => formulateBoundaryViolationHypothesis(b));
      const actions = synthesizeBoundaryRemediationActions(hypotheses, allBlunders);
      expect(actions.length).toBeGreaterThanOrEqual(allBlunders.length);
      for (const action of actions) {
        expect(action.blunder_id.length).toBeGreaterThan(0);
        expect(["tighten_boundary", "add_test_gate", "update_invariants"]).toContain(
          action.action_type,
        );
        expect(action.description.length).toBeGreaterThan(0);
        expect(action.prescribed_test.length).toBeGreaterThan(0);
        expect(action.target_scope.length).toBeGreaterThan(0);
      }
    });

    test("constructs deliberation round and remediation synthesis across all blunders", () => {
      const round = createBlunderDeliberationRound({
        round_number: 1,
        capsule_root: process.cwd(),
        blunders: allBlunders,
      });

      expect(round.round_number).toBe(1);
      expect(round.hypotheses.length).toBe(allBlunders.length);
      expect(round.remediation_actions.length).toBeGreaterThan(0);
      expect(round.synthesis).toBeDefined();
      expect(round.synthesis.unresolved_blunder_ids.length).toBe(allBlunders.length);
    });
  });

  describe("Regression Test Generation & Assertion Hardening", () => {
    test("generates syntactically valid regression test cases for every blunder instance", () => {
      for (const blunder of allBlunders) {
        const generated = generateBlunderRegressionTest(blunder, {
          includeComments: true,
        });

        expect(generated.blunder_id).toBe(blunder.id);
        expect(generated.test_name).toContain(blunder.id);
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

    test("generates complete regression test suite spanning all blunder instances", () => {
      const suiteCode = generateRegressionTestSuite(allBlunders, {
        suiteName: "46+ Blunder Remediation Master Regression Suite",
        bannerTitle: "Comprehensive Historical Blunder Protection Suite",
      });

      expect(suiteCode).toContain("46+ Blunder Remediation Master Regression Suite");
      expect(suiteCode).toContain("Comprehensive Historical Blunder Protection Suite");
      expect(suiteCode).toContain(`Total blunders protected: ${allBlunders.length}`);

      const validation = validateRegressionTest(suiteCode);
      expect(validation.isValid).toBe(true);
      expect(validation.issues).toHaveLength(0);
    });
  });

  describe("Resolution Proof Formulation & Empirical Verification", () => {
    test("validates empirical resolution proofs for all 46+ blunder instances", () => {
      for (let i = 0; i < allBlunders.length; i++) {
        const blunder = allBlunders[i]!;
        const proof: BlunderResolutionProof = {
          task_id: `task-remediate-${blunder.id}`,
          test_assertion: `expect(isBoundaryConcurred).toBeTrue() // blunder ${blunder.id}`,
          resolved_at: new Date().toISOString(),
          commit_sha: "a1b2c3d4e5f678901234567890abcdef12345678",
          remediation_notes: `Remediated blunder ${blunder.id} via subagent enforcement`,
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

    test("resolving all blunder instances transitions status to resolved and passes promotion eligibility", () => {
      for (const blunder of allBlunders) {
        const proof: BlunderResolutionProof = {
          task_id: `task-remediate-${blunder.id}`,
          test_assertion: `verifyBoundaryConfinement("${blunder.id}") === true`,
          resolved_at: new Date().toISOString(),
          commit_sha: "1234567890abcdef1234567890abcdef12345678",
        };

        const resolved = resolveBlunder(blunder, proof);
        expect(resolved.status).toBe("resolved");
        expect(resolved.resolution).toEqual(proof);

        const eligible = isBlunderEligibleForPromotion(resolved, { requireCommitSha: true });
        expect(eligible).toBe(true);
      }
    });

    test("formulates candidate proposals from open blunders for self-evolution planning", () => {
      const candidates = formulateBlunderCandidates(allBlunders);
      expect(candidates.length).toBe(allBlunders.length);
      for (const candidate of candidates) {
        expect(candidate.kind).toBe("proposal");
        expect(candidate.blunder_id).toBeDefined();
        expect(candidate.statement.length).toBeGreaterThan(0);
        expect(candidate.rationale.length).toBeGreaterThan(0);
        expect(candidate.write_scope.length).toBeGreaterThan(0);
        expect(candidate.charter_goal_ids.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Capsule Audit Report Synthesis", () => {
    test("generates comprehensive audit report across test workspace", () => {
      const tempDir = createTempDir("blunder-audit-test-");
      const capsuleDir = join(tempDir, ".capsules", "mind", "queue");
      mkdirSync(capsuleDir, { recursive: true });

      const logPath = join(capsuleDir, "blunders.jsonl");
      writeFileSync(logPath, serializeBlunderLog(allBlunders), "utf8");

      const report = auditBlunderLog([tempDir]);
      expect(report.total_blunders).toBe(allBlunders.length);
      expect(report.open_count).toBe(allBlunders.length);
      expect(report.resolved_count).toBe(0);
      expect(report.by_category.boundary_violation).toBe(allBlunders.length);
      expect(report.by_severity.critical).toBe(allBlunders.length);

      const brief = formatBlunderAuditBrief(report);
      expect(brief).toContain("Blunder Audit & Remediation Brief");
      expect(brief).toContain(`Total Blunders**: \`${allBlunders.length}\``);
      expect(brief).toContain(`boundary_violation: ${allBlunders.length}`);
    });

    test("verifies global skill sync module exports Gen5 status", () => {
      expect(GLOBAL_SYNC_GEN5).toBe(true);
    });
  });
});
