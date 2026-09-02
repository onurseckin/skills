import { describe, expect, it } from "bun:test";
import {
  formatCitation,
  formatFindingLine,
  formatGateLine,
  formatEscalationLine,
  formatDeclinedCandidateLine,
  formatOpenProposalLine,
  formatOwnerDigestMarkdown,
  formatEscalationDigestMarkdown,
  formatMemoryDigestMarkdown,
} from "../../../olt/scripts/src/mind/memory/digest/formatter.ts";
import type {
  DigestDeclinedCandidate,
  DigestEscalation,
  DigestFailingGate,
  DigestFinding,
  DigestOpenProposal,
  EscalationDigestData,
} from "../../../olt/scripts/src/mind/memory/digest/types.ts";

describe("Mind Memory Digest Formatter Module", () => {
  describe("formatCitation", () => {
    it("returns empty string when options are empty or undefined", () => {
      expect(formatCitation({})).toBe("");
      expect(
        formatCitation({
          commandSource: undefined,
          witnessCommandId: undefined,
          eventIndex: undefined,
        }),
      ).toBe("");
    });

    it("formats witnessCommandId with precedence over commandSource", () => {
      expect(formatCitation({ witnessCommandId: "cmd-wit-1" })).toBe(" (witness: `cmd-wit-1`)");
      expect(
        formatCitation({ witnessCommandId: "cmd-wit-1", commandSource: "cmd-src-ignored" }),
      ).toBe(" (witness: `cmd-wit-1`)");
    });

    it("formats commandSource when witnessCommandId is absent", () => {
      expect(formatCitation({ commandSource: "cmd-src-2" })).toBe(" (source: `cmd-src-2`)");
    });

    it("formats eventIndex and combinations", () => {
      expect(formatCitation({ eventIndex: 0 })).toBe(" (event: #0)");
      expect(formatCitation({ eventIndex: 42 })).toBe(" (event: #42)");
      expect(formatCitation({ commandSource: "src-cmd", eventIndex: 7 })).toBe(
        " (source: `src-cmd`, event: #7)",
      );
      expect(formatCitation({ witnessCommandId: "wit-cmd", eventIndex: 12 })).toBe(
        " (witness: `wit-cmd`, event: #12)",
      );
    });
  });

  describe("formatFindingLine", () => {
    it("formats finding with minimal fields", () => {
      const f: DigestFinding = { findingId: "f-1", observation: "Missing validation check" };
      expect(formatFindingLine(f)).toBe("  - `[f-1]`: Missing validation check");
    });

    it("formats finding with taskId taking precedence over runId, and with runId only", () => {
      const f1: DigestFinding = {
        findingId: "f-2",
        observation: "Syntax error",
        taskId: "task-99",
        runId: "run-alpha",
      };
      expect(formatFindingLine(f1)).toBe("  - `[f-2]` (task `task-99`): Syntax error");
      const f2: DigestFinding = {
        findingId: "f-3",
        observation: "Uncaught exception",
        runId: "run-beta",
      };
      expect(formatFindingLine(f2)).toBe("  - `[f-3]` (run `run-beta`): Uncaught exception");
    });

    it("formats finding with all optional fields and citations", () => {
      const f: DigestFinding = {
        findingId: "f-4",
        observation: "Memory leak detected",
        severity: "CRITICAL",
        taskId: "task-10",
        remediation: "Add dispose logic",
        revalidationGate: "gate-mem-check",
        commandSource: "cmd-bench",
        eventIndex: 3,
      };
      expect(formatFindingLine(f)).toBe(
        "  - `[f-4]` [CRITICAL] (task `task-10`): Memory leak detected — Remediation: Add dispose logic — Revalidation: `gate-mem-check` (source: `cmd-bench`, event: #3)",
      );
    });
  });

  describe("formatGateLine", () => {
    it("formats gate with array command, taskId, exitCode, snippet, and citation", () => {
      const g: DigestFailingGate = {
        gateId: "gate-unit",
        command: ["bun", "test", "src/auth.test.ts"],
        taskId: "task-auth",
        exitCode: 1,
        failureSnippet: "Auth test failed",
        commandSource: "cmd-runner",
        eventIndex: 5,
      };
      expect(formatGateLine(g)).toBe(
        "  - `gate-unit` (task `task-auth`): `bun test src/auth.test.ts` (exit code 1) — Auth test failed (source: `cmd-runner`, event: #5)",
      );
    });

    it("formats gate with string command, runId, exitCode 0, without snippet or task", () => {
      const g1: DigestFailingGate = {
        gateId: "gate-lint",
        command: "eslint src/",
        runId: "run-lint",
        exitCode: 0,
      };
      expect(formatGateLine(g1)).toBe(
        "  - `gate-lint` (run `run-lint`): `eslint src/` (exit code 0)",
      );
      const g2: DigestFailingGate = { gateId: "gate-simple", command: "make build" };
      expect(formatGateLine(g2)).toBe("  - `gate-simple`: `make build`");
    });
  });

  describe("formatEscalationLine", () => {
    it("formats escalation with all fields including evidence and citation", () => {
      const e: DigestEscalation = {
        escalationId: "esc-1",
        reason: "Resource budget exceeded",
        taskId: "task-exec",
        evidence: "100MB over limit",
        commandSource: "cmd-monitor",
        eventIndex: 9,
      };
      expect(formatEscalationLine(e)).toBe(
        "  - `esc-1` (task `task-exec`): Resource budget exceeded — 100MB over limit (source: `cmd-monitor`, event: #9)",
      );
    });

    it("formats escalation with runId only or without run/task", () => {
      const e1: DigestEscalation = {
        escalationId: "esc-2",
        reason: "Permission denied",
        runId: "run-sec",
      };
      expect(formatEscalationLine(e1)).toBe("  - `esc-2` (run `run-sec`): Permission denied");
      const e2: DigestEscalation = { escalationId: "esc-3", reason: "Timeout" };
      expect(formatEscalationLine(e2)).toBe("  - `esc-3`: Timeout");
    });
  });

  describe("formatDeclinedCandidateLine & formatOpenProposalLine", () => {
    it("formats declined candidate with full metadata, commandSource fallback, and minimal fields", () => {
      const c1: DigestDeclinedCandidate = {
        candidateId: "cand-1",
        statement: "Refactor core loop",
        declineReason: "Premature optimization",
        charterGoalId: "G-PERF",
        witnessCommandId: "cmd-bench-fail",
        eventIndex: 4,
      };
      expect(formatDeclinedCandidateLine(c1)).toBe(
        '  - `cand-1`: "Refactor core loop" — Reason: Premature optimization (goal: `G-PERF`, witness: `cmd-bench-fail`, event: #4)',
      );
      const c2: DigestDeclinedCandidate = {
        candidateId: "cand-2",
        statement: "Delete legacy tests",
        declineReason: "Coverage loss",
        commandSource: "cmd-audit",
      };
      expect(formatDeclinedCandidateLine(c2)).toBe(
        '  - `cand-2`: "Delete legacy tests" — Reason: Coverage loss (witness: `cmd-audit`)',
      );
      const c3: DigestDeclinedCandidate = {
        candidateId: "cand-3",
        statement: "Update readme",
        declineReason: "Duplicate proposal",
      };
      expect(formatDeclinedCandidateLine(c3)).toBe(
        '  - `cand-3`: "Update readme" — Reason: Duplicate proposal',
      );
    });

    it("formats open proposal with all metadata and minimal fields", () => {
      const p1: DigestOpenProposal = {
        proposalId: "prop-1",
        statement: "Add caching layer",
        rationale: "Reduces latency by 40%",
        charterGoalId: "G-LATENCY",
        requirementId: "REQ-101",
        commandSource: "cmd-profile",
        eventIndex: 11,
      };
      expect(formatOpenProposalLine(p1)).toBe(
        '  - `prop-1`: "Add caching layer" — Rationale: Reduces latency by 40% (goal: `G-LATENCY`, requirement: `REQ-101`, source: `cmd-profile`, event: #11)',
      );
      const p2: DigestOpenProposal = {
        proposalId: "prop-2",
        statement: "Simplify logger",
        rationale: "Cleaner outputs",
      };
      expect(formatOpenProposalLine(p2)).toBe(
        '  - `prop-2`: "Simplify logger" — Rationale: Cleaner outputs',
      );
    });
  });

  describe("formatOwnerDigestMarkdown, formatEscalationDigestMarkdown, formatMemoryDigestMarkdown", () => {
    const baseDigest: EscalationDigestData = {
      runId: "run-main",
      generatedAt: "2026-09-01T12:00:00.000Z",
      openFindings: [],
      failingGates: [],
      escalations: [],
      declinedCandidates: [],
      openProposals: [],
      totalSignalsCount: 0,
      trailingValueSeries: {
        rawValues: [0, 0, 0, 0, 0],
        totalValue: 0,
        trailingZeroStreak: 5,
        isFlatZero: true,
        formattedSeries: "0,0,0,0,0",
      },
    };

    it("renders owner digest with flat zero warning and populated sections", () => {
      const mdEmpty = formatOwnerDigestMarkdown(baseDigest);
      expect(mdEmpty).toContain("### Owner Digest: `run-main`");
      expect(mdEmpty).toContain("Flat Zero Series");

      const mdUnasked = formatOwnerDigestMarkdown(baseDigest, {
        explicitEmptyUnasked: false,
        title: "Custom Title",
      });
      expect(mdUnasked).toContain("### Custom Title: `run-main`");

      const populated: EscalationDigestData = {
        ...baseDigest,
        openFindings: [{ findingId: "f-1", observation: "Found issue" }],
        failingGates: [{ gateId: "g-1", command: "test" }],
        escalations: [{ escalationId: "e-1", reason: "Needs review" }],
        declinedCandidates: [
          { candidateId: "c-1", statement: "Do X", declineReason: "Out of scope" },
        ],
        openProposals: [{ proposalId: "p-1", statement: "Do Y", rationale: "Good idea" }],
        trailingValueSeries: {
          rawValues: [10, 5],
          totalValue: 15,
          trailingZeroStreak: 0,
          isFlatZero: false,
          formattedSeries: "10,5",
        },
      };
      const mdPop = formatOwnerDigestMarkdown(populated);
      expect(mdPop).toContain("- `[f-1]`: Found issue");
      expect(mdPop).toContain("- `g-1`: `test`");

      expect(
        formatOwnerDigestMarkdown(baseDigest, { includeTrailingValueSeries: false }),
      ).not.toContain("## Trailing value series");
      expect(
        formatOwnerDigestMarkdown({
          ...baseDigest,
          trailingValueSeries: {
            rawValues: [0, 0],
            totalValue: 0,
            trailingZeroStreak: 2,
            isFlatZero: true,
            formattedSeries: "0,0",
          },
        }),
      ).not.toContain("Flat Zero Series");

      expect(formatEscalationDigestMarkdown(baseDigest)).toContain(
        "### Escalation Digest: `run-main`",
      );
      expect(formatMemoryDigestMarkdown(baseDigest)).toBe(formatOwnerDigestMarkdown(baseDigest));
    });
  });
});
