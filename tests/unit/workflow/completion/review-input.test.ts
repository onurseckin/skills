import { describe, expect, test } from "bun:test";
import { parseCompletionAssessment } from "../../../../olt/scripts/src/workflow/completion/review-input.ts";
import { workflowState } from "../test-port.ts";

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    findings: [],
    unresolved_finding_ids: [],
    status: "clean",
    requirement_proofs: [
      {
        requirement_id: "R-1",
        status: "satisfied",
        evidence: [{ kind: "command", reference: "C-1", observation: "ok" }],
      },
    ],
    residual_risks: [],
    ...overrides,
  };
}

describe("parseCompletionAssessment: findings file_paths", () => {
  test("keeps trimmed, non-blank file_paths on a finding", () => {
    const state = workflowState();
    const assessment = parseCompletionAssessment(
      state,
      baseInput({
        findings: [
          {
            id: "F-1",
            requirement_id: "R-1",
            severity: "minor",
            observation: "obs",
            remediation: "fix",
            revalidation: "re-run",
            evidence: [{ kind: "critic_assertion" }],
            file_paths: [" src/a.ts ", "", "src/b.ts"],
          },
        ],
        unresolved_finding_ids: ["F-1"],
        status: "findings",
      }),
    );
    expect(assessment.findings[0]!.file_paths).toEqual(["src/a.ts", "src/b.ts"]);
  });

  test("omits file_paths entirely when the field is absent", () => {
    const state = workflowState();
    const assessment = parseCompletionAssessment(
      state,
      baseInput({
        findings: [
          {
            id: "F-1",
            requirement_id: "R-1",
            severity: "minor",
            observation: "obs",
            remediation: "fix",
            revalidation: "re-run",
            evidence: [{ kind: "critic_assertion" }],
          },
        ],
        unresolved_finding_ids: ["F-1"],
        status: "findings",
      }),
    );
    expect(assessment.findings[0]!.file_paths).toBeUndefined();
  });
});

describe("parseCompletionAssessment: residual risks", () => {
  test("accepts a well-formed, accepted residual risk", () => {
    const state = workflowState();
    const assessment = parseCompletionAssessment(
      state,
      baseInput({
        residual_risks: [
          {
            id: "RISK-1",
            severity: "minor",
            description: "a known limitation",
            disposition: "accepted",
            rationale: "acceptable for now",
            evidence: [{ kind: "critic_assertion" }],
          },
        ],
      }),
    );
    expect(assessment.residual_risks).toEqual([
      {
        id: "RISK-1",
        severity: "minor",
        description: "a known limitation",
        disposition: "accepted",
        rationale: "acceptable for now",
        evidence: [{ kind: "critic_assertion" }],
      },
    ]);
  });

  test("throws INVALID_ARGUMENT when residual_risks is not an array", () => {
    const state = workflowState();
    expect(() => parseCompletionAssessment(state, baseInput({ residual_risks: "nope" }))).toThrow(
      /residual_risks must be an explicit array/,
    );
  });

  test("throws INVALID_ARGUMENT for a duplicate residual risk id", () => {
    const state = workflowState();
    const risk = {
      id: "RISK-1",
      severity: "minor",
      description: "d",
      disposition: "accepted",
      rationale: "r",
      evidence: [{ kind: "critic_assertion" }],
    };
    expect(() =>
      parseCompletionAssessment(state, baseInput({ residual_risks: [risk, risk] })),
    ).toThrow(/invalid residual risk: RISK-1/);
  });

  test("throws INVALID_ARGUMENT for an unrecognised severity", () => {
    const state = workflowState();
    expect(() =>
      parseCompletionAssessment(
        state,
        baseInput({
          residual_risks: [
            {
              id: "RISK-1",
              severity: "urgent",
              description: "d",
              disposition: "accepted",
              rationale: "r",
              evidence: [{ kind: "x" }],
            },
          ],
        }),
      ),
    ).toThrow(/invalid residual risk: RISK-1/);
  });

  test("throws INVALID_ARGUMENT when disposition is not exactly 'accepted'", () => {
    const state = workflowState();
    expect(() =>
      parseCompletionAssessment(
        state,
        baseInput({
          residual_risks: [
            {
              id: "RISK-1",
              severity: "minor",
              description: "d",
              disposition: "deferred",
              rationale: "r",
              evidence: [{ kind: "x" }],
            },
          ],
        }),
      ),
    ).toThrow(/invalid residual risk: RISK-1/);
  });

  test("throws INVALID_ARGUMENT when a residual risk entry is not an object", () => {
    const state = workflowState();
    expect(() =>
      parseCompletionAssessment(state, baseInput({ residual_risks: ["not-an-object"] })),
    ).toThrow(/residual risk must be an object/);
  });
});

describe("parseCompletionAssessment: anti-batching enforcement", () => {
  test("throws INVALID_ARGUMENT when multiple requirements share empty or generic proof evidence", () => {
    const state = workflowState();
    state.requirements.push({
      id: "R-2",
      status: "planned",
      evidence: [],
      dependencies: [],
    });

    // Multiple satisfied requirements with generic evidence reference
    expect(() =>
      parseCompletionAssessment(
        state,
        baseInput({
          requirement_proofs: [
            {
              requirement_id: "R-1",
              status: "satisfied",
              evidence: [{ kind: "command", reference: "generic-check", observation: "ok" }],
            },
            {
              requirement_id: "R-2",
              status: "satisfied",
              evidence: [{ kind: "command", reference: "generic-check", observation: "ok" }],
            },
          ],
        }),
      ),
    ).toThrow(/anti-batching violation/);
  });
});
