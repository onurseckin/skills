import { describe, expect, it } from "bun:test";
import {
  normalizeFindingToDetail,
  synthesizeNextRoundPrompt,
} from "../../olt/scripts/src/orchestrator/defect-synthesizer.ts";
import type { Finding } from "../../olt/scripts/src/core/contracts/index.ts";
import type { FindingDetail } from "../../olt/scripts/src/workflow/scope-partitioner.ts";

describe("Defect Synthesizer Unit Tests", () => {
  it("normalizes Finding contracts and infers file paths from text", () => {
    const finding: Finding = {
      id: "f-01",
      requirement_id: "req-auth",
      severity: "critical",
      observation: "Token validation failed in src/auth/token.ts during boundary check",
      evidence: [],
      remediation: "Add null check in src/auth/token.ts and tests/unit/auth/token.test.ts",
      revalidation: "bun test tests/unit/auth/token.test.ts",
      status: "open",
    };

    const detail = normalizeFindingToDetail(finding);
    expect(detail.id).toBe("f-01");
    expect(detail.requirement_id).toBe("req-auth");
    expect(detail.severity).toBe("critical");
    expect(detail.file_paths).toContain("src/auth/token.ts");
    expect(detail.file_paths).toContain("tests/unit/auth/token.test.ts");
    expect(detail.file_paths_evidence_class).toBe("derived");
    expect(detail.revalidation_gate).toBe("bun test tests/unit/auth/token.test.ts");
  });

  it("passes through already formatted FindingDetail objects", () => {
    const detailInput: FindingDetail = {
      id: "f-02",
      requirement_id: "req-ui",
      severity: "minor",
      file_paths: ["src/components/Button.tsx"],
      observation: "Button border is 1px off",
      remediation: "Update border width",
      revalidation_gate: "bun test src/components",
    };

    const detail = normalizeFindingToDetail(detailInput);
    expect(detail.id).toBe("f-02");
    expect(detail.file_paths).toEqual(["src/components/Button.tsx"]);
    expect(detail.file_paths_evidence_class).toBe("agent_reported");
    expect(detail.severity).toBe("minor");
  });

  it("records no file paths when the finding text names none", () => {
    const finding: Finding = {
      id: "f-03",
      requirement_id: "req-gen",
      severity: "important",
      observation: "General system failure",
      evidence: [],
      remediation: "Fix the configuration",
      revalidation: "bun test tests",
      status: "open",
    };

    const detail = normalizeFindingToDetail(finding);
    expect(detail.file_paths).toEqual([]);
    expect(detail.file_paths_evidence_class).toBe("derived");
  });

  it("deduplicates findings with identical IDs and merges file paths", () => {
    const findings: FindingDetail[] = [
      {
        id: "f-dup",
        requirement_id: "req-1",
        severity: "critical",
        file_paths: ["src/core/a.ts"],
        observation: "First occurrence of bug",
        remediation: "Fix in a.ts",
      },
      {
        id: "f-dup",
        requirement_id: "req-1",
        severity: "critical",
        file_paths: ["src/core/b.ts", "src/core/a.ts"],
        observation: "Second occurrence of same bug",
        remediation: "Fix in a.ts and b.ts",
      },
    ];

    const synthesis = synthesizeNextRoundPrompt({
      roundNumber: 2,
      priorRunId: "run-dup-test",
      originalPrompt: "Core prompt",
      findings,
    });

    expect(synthesis.unresolvedFindings.length).toBe(1);
    expect(synthesis.unresolvedFindings[0]?.id).toBe("f-dup");
    expect(synthesis.unresolvedFindings[0]?.file_paths).toEqual(["src/core/a.ts", "src/core/b.ts"]);
    expect(synthesis.synthesizedPrompt).toContain("[f-dup]");
    // Ensure prompt does not repeat [f-dup] header twice
    const occurrences = (synthesis.synthesizedPrompt.match(/\[f-dup\]/g) || []).length;
    expect(occurrences).toBe(1);
  });

  it("synthesizes prompt with empty findings cleanly", () => {
    const synthesis = synthesizeNextRoundPrompt({
      roundNumber: 2,
      priorRunId: "run-alpha-r1",
      originalPrompt: "Implement user authentication and profile page.",
      findings: [],
    });

    expect(synthesis.roundNumber).toBe(2);
    expect(synthesis.priorRunId).toBe("run-alpha-r1");
    expect(synthesis.unresolvedFindings.length).toBe(0);
    expect(synthesis.synthesizedPrompt).toContain("Round 2 Refinement Directive");
    expect(synthesis.synthesizedPrompt).toContain(
      "Implement user authentication and profile page.",
    );
    expect(synthesis.synthesizedPrompt).toContain("No explicit structured findings recorded.");
  });

  it("synthesizes structured prompt with categorized findings, critic feedback, and failed gates", () => {
    const findings: FindingDetail[] = [
      {
        id: "crit-01",
        requirement_id: "req-db",
        severity: "critical",
        file_paths: ["src/db/connection.ts"],
        observation: "Database connection leak on timeout",
        remediation: "Ensure pool.close() in finally block",
        revalidation_gate: "bun test tests/unit/db",
      },
      {
        id: "imp-01",
        requirement_id: "req-api",
        severity: "important",
        file_paths: ["src/api/routes.ts"],
        observation: "Missing 404 handler",
        remediation: "Add catch-all route",
        revalidation_gate: "bun test tests/unit/api",
      },
      {
        id: "min-01",
        requirement_id: "req-docs",
        severity: "minor",
        file_paths: ["README.md"],
        observation: "Typo in installation docs",
        remediation: "Fix typo",
      },
    ];

    const synthesis = synthesizeNextRoundPrompt({
      roundNumber: 3,
      priorRunId: "run-beta-r2",
      originalPrompt: "Build full stack API",
      findings,
      criticFeedback: "Critic identified memory leak in DB pool.",
      gateFailures: ["bun test tests/unit/db", "bun test tests/unit/api"],
    });

    expect(synthesis.roundNumber).toBe(3);
    expect(synthesis.unresolvedFindings.length).toBe(3);
    expect(synthesis.affectedFiles).toEqual([
      "README.md",
      "src/api/routes.ts",
      "src/db/connection.ts",
    ]);
    expect(synthesis.synthesizedPrompt).toContain("🔴 Critical Findings");
    expect(synthesis.synthesizedPrompt).toContain("[crit-01]");
    expect(synthesis.synthesizedPrompt).toContain("🟡 Important Findings");
    expect(synthesis.synthesizedPrompt).toContain("[imp-01]");
    expect(synthesis.synthesizedPrompt).toContain("⚪ Minor Findings & Suggestions");
    expect(synthesis.synthesizedPrompt).toContain("[min-01]");
    expect(synthesis.synthesizedPrompt).toContain("Critic identified memory leak in DB pool.");
    expect(synthesis.synthesizedPrompt).toContain("❌ `bun test tests/unit/db`");
  });
});
