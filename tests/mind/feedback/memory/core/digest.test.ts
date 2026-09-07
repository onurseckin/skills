import { describe, expect, it } from "bun:test";
import {
  formatCitation,
  formatDeclinedCandidateLine,
  formatEscalationDigestMarkdown,
  formatEscalationLine,
  formatFindingLine,
  formatGateLine,
  formatMemoryDigestMarkdown,
  formatOpenProposalLine,
  formatOwnerDigestMarkdown,
} from "../../../../../olt/scripts/src/mind/memory/digest/formatter.ts";
import type {
  DigestDeclinedCandidate,
  DigestEscalation,
  DigestFailingGate,
  DigestFinding,
  DigestOpenProposal,
  EscalationDigestData,
} from "../../../../../olt/scripts/src/mind/memory/digest/types.ts";

describe("Mind Memory Digest Formatter Coverage Suite", () => {
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

    it("prioritizes witnessCommandId over commandSource and formats event indices", () => {
      expect(formatCitation({ witnessCommandId: "cmd-wit-1" })).toBe(" (witness: `cmd-wit-1`)");
      expect(
        formatCitation({ witnessCommandId: "cmd-wit-1", commandSource: "cmd-src-ignored" }),
      ).toBe(" (witness: `cmd-wit-1`)");
      expect(formatCitation({ commandSource: "cmd-src-2" })).toBe(" (source: `cmd-src-2`)");
      expect(formatCitation({ eventIndex: 0 })).toBe(" (event: #0)");
      expect(formatCitation({ witnessCommandId: "cmd-wit-2", eventIndex: 7 })).toBe(
        " (witness: `cmd-wit-2`, event: #7)",
      );
    });
  });

  describe("formatFindingLine", () => {
    it("formats finding with minimal fields and verifies task ID precedence over run ID", () => {
      const fMin: DigestFinding = { findingId: "f-1", observation: "Missing validation check" };
      expect(formatFindingLine(fMin)).toBe("  - `[f-1]`: Missing validation check");

      const fTask: DigestFinding = {
        findingId: "f-2",
        observation: "Syntax error",
        taskId: "task-99",
        runId: "run-alpha",
      };
      expect(formatFindingLine(fTask)).toBe("  - `[f-2]` (task `task-99`): Syntax error");

      const fRunOnly: DigestFinding = {
        findingId: "f-3",
        observation: "Uncaught exception",
        runId: "run-beta",
      };
      expect(formatFindingLine(fRunOnly)).toBe("  - `[f-3]` (run `run-beta`): Uncaught exception");
    });

    it("formats finding with severity, remediation, revalidation, and citations", () => {
      const finding: DigestFinding = {
        findingId: "f-4",
        observation: "Memory leak detected",
        severity: "CRITICAL",
        taskId: "task-10",
        remediation: "Add dispose logic",
        revalidationGate: "gate-mem-check",
        commandSource: "cmd-bench",
        eventIndex: 3,
      };
      expect(formatFindingLine(finding)).toBe(
        "  - `[f-4]` [CRITICAL] (task `task-10`): Memory leak detected — Remediation: Add dispose logic — Revalidation: `gate-mem-check` (source: `cmd-bench`, event: #3)",
      );
    });
  });

  describe("formatGateLine and formatEscalationLine", () => {
    it("handles command as array or string and incorporates exit code and snippets", () => {
      const gateArr: DigestFailingGate = {
        gateId: "gate-unit",
        command: ["bun", "test", "suite.ts"],
        taskId: "task-5",
        exitCode: 1,
        failureSnippet: "1 test failed",
        commandSource: "cmd-runner",
        eventIndex: 2,
      };
      expect(formatGateLine(gateArr)).toBe(
        "  - `gate-unit` (task `task-5`): `bun test suite.ts` (exit code 1) — 1 test failed (source: `cmd-runner`, event: #2)",
      );

      const gateStr: DigestFailingGate = {
        gateId: "gate-lint",
        command: "oxlint",
        runId: "run-1",
      };
      expect(formatGateLine(gateStr)).toBe("  - `gate-lint` (run `run-1`): `oxlint`");

      const cleanGate: DigestFailingGate = {
        gateId: "gate-clean",
        command: "bun test",
        exitCode: 0,
      };
      expect(formatGateLine(cleanGate)).toBe("  - `gate-clean`: `bun test` (exit code 0)");
    });

    it("handles findings with empty string optional fields gracefully", () => {
      const fEmptyOptionals: DigestFinding = {
        findingId: "f-empty-opt",
        observation: "Observation only",
        severity: "",
        remediation: "",
        revalidationGate: "",
      };
      expect(formatFindingLine(fEmptyOptionals)).toBe("  - `[f-empty-opt]`: Observation only");
    });

    it("formats escalation with reason, evidence, and citations", () => {
      const esc: DigestEscalation = {
        escalationId: "esc-1",
        reason: "Resource threshold exceeded",
        taskId: "task-esc",
        evidence: "RAM usage at 98%",
        commandSource: "cmd-watchdog",
      };
      expect(formatEscalationLine(esc)).toBe(
        "  - `esc-1` (task `task-esc`): Resource threshold exceeded — RAM usage at 98% (source: `cmd-watchdog`)",
      );
    });
  });

  describe("formatDeclinedCandidateLine and formatOpenProposalLine", () => {
    it("formats declined candidate and open proposal with goals, requirements, and metadata", () => {
      const candidate: DigestDeclinedCandidate = {
        candidateId: "cand-1",
        statement: "Add external redis cache",
        declineReason: "Prefers in-memory zero-disk model",
        charterGoalId: "G1",
        witnessCommandId: "wit-cmd-1",
        eventIndex: 10,
      };
      expect(formatDeclinedCandidateLine(candidate)).toBe(
        '  - `cand-1`: "Add external redis cache" — Reason: Prefers in-memory zero-disk model (goal: `G1`, witness: `wit-cmd-1`, event: #10)',
      );

      const proposal: DigestOpenProposal = {
        proposalId: "prop-1",
        statement: "Adopt VirtualMemoryFS across unit tests",
        rationale: "Prevents SSD hardware wear and APFS locks",
        charterGoalId: "G2",
        requirementId: "REQ-ZERO-DISK",
        commandSource: "cmd-prop",
        eventIndex: 4,
      };
      expect(formatOpenProposalLine(proposal)).toBe(
        '  - `prop-1`: "Adopt VirtualMemoryFS across unit tests" — Rationale: Prevents SSD hardware wear and APFS locks (goal: `G2`, requirement: `REQ-ZERO-DISK`, source: `cmd-prop`, event: #4)',
      );
    });
  });

  describe("formatOwnerDigestMarkdown and formatEscalationDigestMarkdown", () => {
    it("synthesizes complete markdown digest with trailing value series and flat-zero warning", () => {
      const digest: EscalationDigestData = {
        runId: "run-gen-10",
        generatedAt: "2026-09-06T12:00:00.000Z",
        openFindings: [{ findingId: "f-1", observation: "Unindexed defect" }],
        failingGates: [{ gateId: "g-1", command: "bun test" }],
        escalations: [{ escalationId: "e-1", reason: "Quota stall" }],
        declinedCandidates: [
          { candidateId: "c-1", statement: "Skip review", declineReason: "Violation" },
        ],
        openProposals: [{ proposalId: "p-1", statement: "Upgrade harness", rationale: "Speed" }],
        trailingValueSeries: {
          formattedSeries: "0, 0, 0, 0, 0",
          totalValue: 0,
          trailingZeroStreak: 5,
          isFlatZero: true,
          rawValues: [0, 0, 0, 0, 0],
        },
      };

      const ownerMd = formatOwnerDigestMarkdown(digest, { title: "Custom Owner Digest" });
      expect(ownerMd).toContain("### Custom Owner Digest: `run-gen-10`");
      expect(ownerMd).toContain("- **Open findings**: 1");
      expect(ownerMd).toContain("- **Failing gates**: 1");
      expect(ownerMd).toContain("- **Escalations (needs human decision)**: 1");
      expect(ownerMd).toContain("- **Declined candidates**: 1");
      expect(ownerMd).toContain("- **Open proposals (needs authority decision)**: 1");
      expect(ownerMd).toContain("## Trailing value series");
      expect(ownerMd).toContain("Flat Zero Series");

      const escMd = formatEscalationDigestMarkdown(digest);
      expect(escMd).toContain("### Escalation Digest: `run-gen-10`");

      const memMd = formatMemoryDigestMarkdown(digest);
      expect(memMd).toContain("run-gen-10");
    });

    it("handles completely empty digest state and explicitEmptyUnasked flag", () => {
      const emptyDigest: EscalationDigestData = {
        runId: "run-empty",
        generatedAt: "2026-09-06T12:00:00.000Z",
        openFindings: [],
        failingGates: [],
        escalations: [],
        declinedCandidates: [],
        openProposals: [],
      };

      const md = formatOwnerDigestMarkdown(emptyDigest, { explicitEmptyUnasked: true });
      expect(md).toContain("No unasked actions or proposals in this period.");
      expect(md).toContain("  - none");

      const mdNonExplicit = formatOwnerDigestMarkdown(emptyDigest, {
        explicitEmptyUnasked: false,
        includeTrailingValueSeries: false,
      });
      expect(mdNonExplicit).toContain("- **Declined candidates**: 0");
      expect(mdNonExplicit).toContain("- **Open proposals (needs authority decision)**: 0");
    });
  });
});
