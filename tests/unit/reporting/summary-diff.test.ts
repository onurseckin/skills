import { describe, expect, it } from "bun:test";
import {
  exportSummaryWithTrunking,
  type SummaryReport,
} from "../../../olt/scripts/src/reporting/summary-exporter.ts";
import {
  analyzeDiffAgainstFidelity,
  type DiffFidelityReport,
} from "../../../olt/scripts/src/reporting/diff-analyzer.ts";
import type { CommandEvidence } from "../../../olt/scripts/src/reporting/evidence-collector.ts";

describe("reporting/summary-exporter and reporting/diff-analyzer", () => {
  describe("exportSummaryWithTrunking", () => {
    it("formats summary report with truncated evidence", () => {
      const evidenceList: CommandEvidence[] = [
        {
          command: "bun test",
          rawOutput: "Pass: 10 tests",
          exitCode: 0,
          timingMs: 120,
          sha256Hash: "abcd1234efgh5678",
        },
        {
          command: "git status",
          rawOutput: "clean working tree",
          exitCode: 0,
          timingMs: 45,
          sha256Hash: "1122334455667788",
        },
      ];

      const report: SummaryReport = {
        taskId: "task-test-summary",
        evidence: evidenceList,
      };

      const formatted = exportSummaryWithTrunking(report);
      expect(formatted).toContain("Summary Report for Task: task-test-summary");
      expect(formatted).toContain("SHA256: abcd1234efgh5678");
      expect(formatted).toContain("Exit Code: 0");
      expect(formatted).toContain("Timing: 120ms");
      expect(formatted).toContain("Output:\nPass: 10 tests");
      expect(formatted).toContain("SHA256: 1122334455667788");
    });

    it("truncates semantic traces exceeding maxLines", async () => {
      const { truncateSemanticTrace } =
        await import("../../../olt/scripts/src/reporting/evidence-collector.ts");
      const longOutput = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
      const evidence: CommandEvidence = {
        exitCode: 0,
        timingMs: 50,
        sha256Hash: "hash123",
        rawOutput: longOutput,
      };

      const truncated = truncateSemanticTrace(evidence, 10);
      expect(truncated.rawOutput).toContain("TRUNCATED 90 lines for token conservation");
      expect(truncated.rawOutput).toContain("line 1");
      expect(truncated.rawOutput).toContain("line 100");

      const shortEvidence = truncateSemanticTrace({ ...evidence, rawOutput: "short" }, 10);
      expect(shortEvidence.rawOutput).toBe("short");
    });
  });

  describe("analyzeDiffAgainstFidelity", () => {
    it("analyzes prompt bytes against diff output and verifies satisfied clauses", () => {
      const prompt = "Implement login page and add auth token validation.";
      const diffOutput = "Added login page and auth token validation in auth.ts";

      const report: DiffFidelityReport = analyzeDiffAgainstFidelity(prompt, diffOutput);
      expect(report.totalClauses).toBeGreaterThan(0);
      expect(report.promptBytesMatched).toBe(true);
      expect(report.unverifiedClauses).toEqual([]);
    });

    it("identifies unverified clauses when diff output is empty", () => {
      const prompt = "Must add database migration and SSL encryption support.";
      const diffOutput = "";

      const report: DiffFidelityReport = analyzeDiffAgainstFidelity(prompt, diffOutput);
      expect(report.promptBytesMatched).toBe(false);
      expect(report.unverifiedClauses.length).toBeGreaterThan(0);
    });
  });
});
