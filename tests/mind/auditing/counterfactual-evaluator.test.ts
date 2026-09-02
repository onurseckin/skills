import { describe, expect, it, spyOn, afterEach } from "bun:test";
import * as simulatorModule from "../../../olt/scripts/src/mind/auditing/counterfactual/simulator.ts";
import {
  runCounterfactualReAdmissionSuite,
  formatCounterfactualReportMarkdown,
} from "../../../olt/scripts/src/mind/auditing/counterfactual/evaluator.ts";
import type { GateEvaluationContext } from "../../../olt/scripts/src/mind/proposals/gates/types.ts";
import type {
  CounterfactualEvaluationResult,
  CounterfactualReAdmissionSuiteResult,
} from "../../../olt/scripts/src/mind/auditing/counterfactual/types.ts";

describe("Mind Counterfactual Evaluator Coverage Suite", () => {
  const spies: Array<{ mockRestore: () => void }> = [];
  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
  });

  const ctx: GateEvaluationContext = {
    runRoot: "/virtual/run-root",
    actor: "evaluator",
    state: {},
    repoRoots: ["."],
  };

  it("handles empty candidate states with zero counts", () => {
    const suite = runCounterfactualReAdmissionSuite({}, ctx);
    expect(suite.totalEvaluated).toBe(0);
    expect(suite.persistentCount).toBe(0);
    expect(suite.clearedCount).toBe(0);
    expect(suite.findingsCount).toBe(0);
    expect(suite.findings).toEqual([]);
    expect(suite.results).toEqual([]);
    expect(typeof suite.evaluatedAt).toBe("string");

    const markdown = formatCounterfactualReportMarkdown(suite);
    expect(markdown).toContain("### Counterfactual Re-Admission Test Report");
    expect(markdown).toContain("- **Total Evaluated**: 0");
    expect(markdown).toContain(
      "_All 0 tested candidate(s) confirmed persistent defect validity under fresh isolated evaluation._",
    );
    expect(markdown).not.toContain("#### Candidate Summaries:");
  });

  it("evaluates candidates tracking persistent defects, findings, and cleared count", () => {
    const mockState = {
      candidates: [
        {
          id: "cand-defect-persist",
          status: "admitted",
          kind: "defect",
          statement: "Persistent bug",
        },
        { id: "cand-defect-cleared", status: "admitted", kind: "defect", statement: "Cleared bug" },
        {
          id: "cand-proposal-clean",
          status: "admitted",
          kind: "proposal",
          statement: "Clean feature",
        },
        { id: "cand-unadmitted", status: "opened", kind: "defect", statement: "Ignored" },
      ],
    };

    spies.push(
      spyOn(simulatorModule, "evaluateCandidateCounterfactual").mockImplementation((cand) => {
        if (cand.id === "cand-defect-persist") {
          return {
            candidateId: cand.id,
            isolatedCandidate: cand,
            admissible: true,
            defectPersists: true,
            evaluatedAt: "2026-09-01T12:00:00.000Z",
            admissionVerdicts: [],
          };
        }
        if (cand.id === "cand-defect-cleared") {
          return {
            candidateId: cand.id,
            isolatedCandidate: cand,
            admissible: false,
            defectPersists: false,
            evaluatedAt: "2026-09-01T12:00:00.000Z",
            admissionVerdicts: [],
            finding: {
              candidateId: cand.id,
              findingKind: "witness_exited_zero",
              message: "Witness command succeeded with exit code 0",
              timestamp: "2026-09-01T12:00:00.000Z",
            },
          };
        }
        return {
          candidateId: cand.id,
          isolatedCandidate: cand,
          admissible: true,
          defectPersists: false,
          evaluatedAt: "2026-09-01T12:00:00.000Z",
          admissionVerdicts: [],
        };
      }),
    );

    const suite = runCounterfactualReAdmissionSuite(mockState, ctx, {
      now: 1788264000000,
      filterKind: undefined,
      strategy: "all",
    });

    expect(suite.totalEvaluated).toBe(3);
    expect(suite.persistentCount).toBe(1);
    expect(suite.clearedCount).toBe(1);
    expect(suite.findingsCount).toBe(1);
    expect(suite.findings).toHaveLength(1);
    expect(suite.findings[0]?.findingKind).toBe("witness_exited_zero");
    expect(suite.results).toHaveLength(3);
  });

  it("formats markdown report with findings and detailed candidate summaries", () => {
    const mockResult: CounterfactualReAdmissionSuiteResult = {
      evaluatedAt: "2026-09-01T12:00:00.000Z",
      totalEvaluated: 2,
      persistentCount: 1,
      clearedCount: 1,
      findingsCount: 1,
      findings: [
        {
          candidateId: "cand-f1",
          findingKind: "falsifier_passed",
          message: "Falsifier exit code 0 observed",
          timestamp: "2026-09-01T12:00:00.000Z",
        },
      ],
      results: [
        {
          candidateId: "cand-p1",
          isolatedCandidate: { id: "cand-p1", kind: "proposal", statement: "Add fast path" },
          admissible: true,
          defectPersists: true,
          evaluatedAt: "2026-09-01T12:00:00.000Z",
          admissionVerdicts: [],
        },
        {
          candidateId: "cand-f1",
          isolatedCandidate: { id: "cand-f1", kind: "defect", statement: "Memory leak" },
          admissible: false,
          defectPersists: false,
          evaluatedAt: "2026-09-01T12:00:00.000Z",
          admissionVerdicts: [],
          finding: {
            candidateId: "cand-f1",
            findingKind: "falsifier_passed",
            message: "Falsifier exit code 0 observed",
            timestamp: "2026-09-01T12:00:00.000Z",
          },
        },
      ],
    };

    const markdown = formatCounterfactualReportMarkdown(mockResult);
    expect(markdown).toContain("### Counterfactual Re-Admission Test Report");
    expect(markdown).toContain("- **Evaluated At**: 2026-09-01T12:00:00.000Z");
    expect(markdown).toContain("- **Persistent Defects (Confirmed)**: 1");
    expect(markdown).toContain("- **Cleared / Non-Persisting Findings**: 1");
    expect(markdown).toContain("#### Findings (1):");
    expect(markdown).toContain(
      "- **[FALSIFIER_PASSED]** Candidate `cand-f1`: Falsifier exit code 0 observed",
    );
    expect(markdown).toContain("#### Candidate Summaries:");
    expect(markdown).toContain('- `cand-p1` [proposal]: **PASS** — "Add fast path"');
    expect(markdown).toContain('- `cand-f1` [defect]: **FINDING** — "Memory leak"');
    expect(markdown).toContain("  - Reason: Falsifier exit code 0 observed");
  });

  it("formats markdown report without findings cleanly", () => {
    const mockResultClean: CounterfactualReAdmissionSuiteResult = {
      evaluatedAt: "2026-09-01T12:00:00.000Z",
      totalEvaluated: 1,
      persistentCount: 1,
      clearedCount: 0,
      findingsCount: 0,
      findings: [],
      results: [
        {
          candidateId: "cand-ok",
          isolatedCandidate: { id: "cand-ok", kind: "defect", statement: "Valid defect" },
          admissible: true,
          defectPersists: true,
          evaluatedAt: "2026-09-01T12:00:00.000Z",
          admissionVerdicts: [],
        },
      ],
    };

    const markdown = formatCounterfactualReportMarkdown(mockResultClean);
    expect(markdown).toContain(
      "_All 1 tested candidate(s) confirmed persistent defect validity under fresh isolated evaluation._",
    );
    expect(markdown).toContain('- `cand-ok` [defect]: **PASS** — "Valid defect"');
    expect(markdown).not.toContain("Reason:");
  });
});
