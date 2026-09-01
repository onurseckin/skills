import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  PROSE_ASSERTION_OVER_EVIDENCE_BIAS,
  assertEvidenceOverProse,
  auditProseAgainstEvidence,
  verifyProseAssertionDefectRemediated,
  type EvidenceAuditOptions,
} from "../../../olt/scripts/src/validation/index.ts";
import { validateZeroCommentsInCode } from "../../../olt/scripts/src/validation/index.ts";
import {
  cleanupVirtualValidationFS,
  scratchRoot,
  setupVirtualValidationFS,
} from "../validation-fixture.ts";

let TEST_DIR: string;

function setupTestEnv(): void {
  TEST_DIR = scratchRoot("prose-assertion-audit", "audit");
  mkdirSync(TEST_DIR, { recursive: true });
}

function cleanupTestEnv(): void {
  // Handled in afterEach
}

describe("Defect Remediation: PROSE_ASSERTION_OVER_EVIDENCE_BIAS Audit", () => {
  beforeEach(() => {
    setupVirtualValidationFS();
  });

  afterEach(() => {
    cleanupVirtualValidationFS();
  });
  describe("3. Remediation of Prose Assertion Over Evidence Bias", () => {
    it("rejects unproven prose report claiming ignition when events.jsonl has 0 command executions", () => {
      setupTestEnv();
      const eventsPath = join(TEST_DIR, "events.jsonl");

      const line1 = JSON.stringify({
        sequence: 1,
        type: "init",
        timestamp: "2026-08-30T00:00:00.000Z",
      });
      writeFileSync(eventsPath, `${line1}\n`);

      const unprovenReport = `
# Antigravity Subagent Execution Report
Ignition was complete and all invariants were enforced.
Everything ran smoothly.
`;

      const audit = auditProseAgainstEvidence({
        eventsPath,
        markdownReport: unprovenReport,
      });

      expect(audit.valid).toBe(false);
      expect(audit.errorCode).toBe(PROSE_ASSERTION_OVER_EVIDENCE_BIAS);
      expect(audit.violations.length).toBeGreaterThan(0);

      const ignitionViolation = audit.violations.find((v) => v.milestoneType === "ignition");
      expect(ignitionViolation).toBeDefined();
      expect(ignitionViolation?.code).toBe(PROSE_ASSERTION_OVER_EVIDENCE_BIAS);
      expect(ignitionViolation?.reason).toContain(
        "sequence is <= 1 with 0 command executions recorded",
      );

      cleanupTestEnv();
    });

    it("rejects unproven prose report claiming 3 commands executed when events.jsonl only records 1", () => {
      setupTestEnv();
      const eventsPath = join(TEST_DIR, "events.jsonl");

      const line1 = JSON.stringify({
        sequence: 1,
        type: "command-executed",
        payload: {
          task_id: "t1",
          actor: "worker",
          command: "bun test",
          argv: ["bun", "test"],
          exit_code: 0,
          stdout_hash: "hash1",
        },
      });
      writeFileSync(eventsPath, `${line1}\n`);

      const unprovenReport = `
### Task Summary
Executed 3 commands in the container.
`;

      const audit = auditProseAgainstEvidence({
        eventsPath,
        markdownReport: unprovenReport,
      });

      expect(audit.valid).toBe(false);
      expect(audit.errorCode).toBe(PROSE_ASSERTION_OVER_EVIDENCE_BIAS);
      const execViolation = audit.violations.find((v) => v.milestoneType === "execution");
      expect(execViolation).toBeDefined();
      expect(execViolation?.reason).toContain(
        "Prose claims 3 command(s) executed, but only 1 command receipt(s) recorded",
      );

      cleanupTestEnv();
    });

    it("rejects report claiming tests passed when 0 command receipts recorded", () => {
      setupTestEnv();
      const eventsPath = join(TEST_DIR, "events.jsonl");
      writeFileSync(eventsPath, `${JSON.stringify({ sequence: 1, type: "init" })}\n`);

      const report = "All tests passed 100% without issues.";
      const audit = auditProseAgainstEvidence({
        eventsPath,
        markdownReport: report,
      });

      expect(audit.valid).toBe(false);
      expect(audit.errorCode).toBe(PROSE_ASSERTION_OVER_EVIDENCE_BIAS);
      const testViolation = audit.violations.find((v) => v.milestoneType === "test_pass");
      expect(testViolation).toBeDefined();
      expect(testViolation?.reason).toContain(
        "0 command receipts or test execution events were recorded",
      );

      cleanupTestEnv();
    });

    it("accepts report when cryptographic evidence in events.jsonl corroborates all claims", () => {
      setupTestEnv();
      const eventsPath = join(TEST_DIR, "events.jsonl");

      const stdoutHash1 = createHash("sha256").update("pass 250 tests").digest("hex");
      const stdoutHash2 = createHash("sha256").update("build output").digest("hex");

      const line1 = JSON.stringify({
        sequence: 1,
        type: "ignition-init",
        sha: "h1",
        parent_sha: "root",
      });
      const line2 = JSON.stringify({
        sequence: 2,
        type: "command-executed",
        sha: "h2",
        parent_sha: "h1",
        payload: {
          task_id: "task-1",
          actor: "worker",
          command: "bun test",
          argv: ["bun", "test"],
          exit_code: 0,
          stdout_hash: stdoutHash1,
        },
      });
      const line3 = JSON.stringify({
        sequence: 3,
        type: "command-executed",
        sha: "h3",
        parent_sha: "h2",
        payload: {
          task_id: "task-2",
          actor: "worker",
          command: "bun run build",
          argv: ["bun", "run", "build"],
          exit_code: 0,
          stdout_hash: stdoutHash2,
        },
      });

      writeFileSync(eventsPath, `${line1}\n${line2}\n${line3}\n`);

      const verifiedReport = `
# Stage Execution
Ignition is complete.
Executed 2 commands successfully.
All tests passed.
Invariants were enforced.
`;

      const audit = auditProseAgainstEvidence({
        eventsPath,
        markdownReport: verifiedReport,
        requireShaChainValidation: true,
      });

      expect(audit.valid).toBe(true);
      expect(audit.defectRemediated).toBe(true);
      expect(audit.violations.length).toBe(0);
      expect(audit.evidenceSummary.totalEvents).toBe(3);
      expect(audit.evidenceSummary.commandReceiptsCount).toBe(2);

      cleanupTestEnv();
    });

    it("throws error with PROSE_ASSERTION_OVER_EVIDENCE_BIAS when assertEvidenceOverProse fails", () => {
      const opts: EvidenceAuditOptions = {
        eventsPath: "/tmp/nonexistent-events.jsonl",
        markdownReport: "Ignition is complete.",
      };

      expect(() => assertEvidenceOverProse(opts)).toThrow(PROSE_ASSERTION_OVER_EVIDENCE_BIAS);
    });

    it("verifies automated defect remediation helper function", () => {
      const result = verifyProseAssertionDefectRemediated();
      expect(result.defectRemediated).toBe(true);
      expect(result.defectId).toBe("defect-prose-assertion-over-evidence-bias");
      expect(result.valid).toBe(true);
    });
  });

  describe("4. Static Invariant Verification", () => {
    it("verifies zero comments, zero any, and zero suppressions across defect files", () => {
      cleanupVirtualValidationFS();
      const filesToCheck = [
        "olt/scripts/src/validation/evidence/auditor.ts",
        "olt/scripts/src/validation/index.ts",
      ];

      const forbiddenTypePattern = new RegExp(":\\s*" + "any\\b|<" + "any>|\\bas\\s+" + "any\\b");
      const tsIgnorePattern = new RegExp("@ts-" + "ignore");
      const tsExpectErrorPattern = new RegExp("@ts-" + "expect-error");
      const eslintDisablePattern = new RegExp("eslint-" + "disable");

      for (const relativePath of filesToCheck) {
        const fullPath = join(process.cwd(), relativePath);
        const code = readFileSync(fullPath, "utf-8");

        const commentCheck = validateZeroCommentsInCode(code, fullPath);
        expect(commentCheck.valid).toBe(true);
        expect(commentCheck.violations.length).toBe(0);

        const hasForbiddenType = forbiddenTypePattern.test(code);
        expect(hasForbiddenType).toBe(false);

        const hasTsIgnore = tsIgnorePattern.test(code);
        expect(hasTsIgnore).toBe(false);

        const hasTsExpectError = tsExpectErrorPattern.test(code);
        expect(hasTsExpectError).toBe(false);

        const hasEslintDisable = eslintDisablePattern.test(code);
        expect(hasEslintDisable).toBe(false);
      }
    });
  });
});
