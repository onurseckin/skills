import { describe, expect, it } from "bun:test";
import {
  advanceDeliberationRound,
  createDefectDeliberationRound,
  DefectDeliberationPipeline,
  formatDefectAuditBrief,
  formatDeliberationReport,
  parseDefectLog,
  serializeDefectLog,
} from "../../../olt/scripts/src/mind/defects/index.ts";
import type {
  DefectCategory,
  DefectEntry,
} from "../../../olt/scripts/src/mind/defects/core/index.ts";

export const deliberationRoundSuiteName = "Defect Deliberation Rounds, Convergence & Markdown Reports";

describe(deliberationRoundSuiteName, () => {
  it("synthesizes deliberation rounds determining convergence vs round advance", () => {
    const defects: DefectEntry[] = [
      {
        id: "b-cd1",
        type: "type_error",
        severity: "high",
        category: "code_defect",
        status: "open",
        observation: "Type mismatch",
        remediation: "Fix types",
        timestamp: "2026-08-22T12:00:00.000Z",
      },
      {
        id: "b-cd2",
        type: "syntax_error",
        severity: "high",
        category: "code_defect",
        status: "open",
        observation: "Syntax err",
        remediation: "Fix syntax",
        timestamp: "2026-08-22T12:00:00.000Z",
      },
    ];

    const round1 = createDefectDeliberationRound({
      defects,
      proofs: [
        {
          task_id: "b-cd1",
          test_assertion: "bun test passes",
          resolved_at: "2026-08-22T12:10:00.000Z",
        },
      ],
      options: { maxRounds: 3 },
    });

    expect(round1.status).toBe("deliberating");
    expect(round1.synthesis.recommendation).toBe("advance_round");
    expect(round1.synthesis.resolved_defect_ids).toContain("b-cd1");
    expect(round1.synthesis.unresolved_defect_ids).toContain("b-cd2");

    const round2 = advanceDeliberationRound(
      round1,
      2,
      defects,
      [
        {
          task_id: "b-cd2",
          test_assertion: "bun test passes with 0 syntax errors",
          resolved_at: "2026-08-22T12:20:00.000Z",
        },
      ],
      { maxRounds: 3 },
    );

    expect(round2.status).toBe("converged");
    expect(round2.synthesis.recommendation).toBe("converge");
    expect(round2.synthesis.readiness_for_convergence).toBe(true);
    expect(round2.synthesis.unresolved_defect_ids).toHaveLength(0);
  });

  it("executes multi-round pipeline to convergence", () => {
    const pipeline = new DefectDeliberationPipeline({ maxRounds: 3 });
    const defects: DefectEntry[] = [
      {
        id: "b-pipe",
        type: "logic_bug",
        severity: "high",
        category: "code_defect",
        status: "open",
        observation: "Logic flaw",
        remediation: "Correct conditional branch",
        timestamp: "2026-08-22T12:00:00.000Z",
      },
    ];

    const round1 = pipeline.startDeliberation(defects);
    expect(round1.status).toBe("deliberating");
    expect(pipeline.isConverged()).toBe(false);

    const round2 = pipeline.advance(defects, [
      {
        task_id: "b-pipe",
        test_assertion: "expect(branch()).toBe(true)",
        resolved_at: "2026-08-22T12:15:00.000Z",
      },
    ]);

    expect(round2.status).toBe("converged");
    expect(pipeline.isConverged()).toBe(true);
    expect(pipeline.getAllRounds()).toHaveLength(2);
  });

  it("parses and serializes defect logs cleanly", () => {
    const raw = [
      JSON.stringify({
        id: "b-parse-1",
        type: "type_error",
        severity: "high",
        category: "code_defect",
        status: "open",
        observation: "Type error",
        remediation: "Fix type",
        timestamp: "2026-08-22T12:00:00.000Z",
      }),
      JSON.stringify({
        id: "b-parse-2",
        type: "role_confusion",
        severity: "critical",
        category: "boundary_violation",
        status: "resolved",
        observation: "Role confusion",
        remediation: "Fix role",
        timestamp: "2026-08-22T12:05:00.000Z",
        resolution: {
          task_id: "task-2",
          test_assertion: "verified",
          resolved_at: "2026-08-22T12:10:00.000Z",
        },
      }),
    ].join("\n");

    const parsed = parseDefectLog(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.category).toBe("code_defect");
    expect(parsed[1]?.status).toBe("resolved");

    const reserialized = serializeDefectLog(parsed);
    expect(reserialized.trim().split("\n")).toHaveLength(2);
  });

  it("formats bounded Markdown briefs for defect audit", () => {
    const report = {
      total_defects: 2,
      open_count: 1,
      resolved_count: 1,
      wontfix_count: 0,
      by_category: {
        code_defect: 1,
        model_reasoning_error: 0,
        boundary_violation: 1,
      },
      by_severity: {
        high: 1,
        critical: 1,
      },
      defects: [
        {
          id: "b-1",
          type: "role_leak",
          severity: "critical",
          category: "boundary_violation" as DefectCategory,
          status: "open" as const,
          observation: "Direct file mutation attempted",
          remediation: "Enforce lease",
          timestamp: "2026-08-22T12:00:00.000Z",
        },
      ],
      capsules_audited: ["/tmp/.capsules/run-sample"],
      generated_at: new Date().toISOString(),
    };

    const brief = formatDefectAuditBrief(report, { maxLines: 30 });
    expect(brief).toContain("### Defect Audit & Remediation Brief");
    expect(brief).toContain("`boundary_violation: 1`");
    expect(brief).toContain("`b-1`");
    expect(brief.split("\n").length).toBeLessThanOrEqual(30);
  });

  it("formats comprehensive deliberation reports bounded by line limit", () => {
    const defects: DefectEntry[] = [
      {
        id: "b-delib-1",
        type: "type_error",
        severity: "high",
        category: "code_defect",
        status: "open",
        observation: "Missing export",
        remediation: "Export type",
        timestamp: "2026-08-22T12:00:00.000Z",
      },
    ];

    const round = createDefectDeliberationRound({
      round_number: 1,
      defects,
      proofs: [
        {
          task_id: "b-delib-1",
          test_assertion: "bun test passes",
          resolved_at: "2026-08-22T12:05:00.000Z",
          commit_sha: "1234567890abcdef",
        },
      ],
    });

    const report = formatDeliberationReport(round, { maxLines: 50 });
    expect(report).toContain("### Mind Defect Deliberation - Round 1");
    expect(report).toContain("#### Root Cause Hypotheses");
    expect(report).toContain("#### Remediation Actions");
    expect(report).toContain("#### Empirical Resolution Proofs");
    expect(report.split("\n").length).toBeLessThanOrEqual(50);
  });
});
