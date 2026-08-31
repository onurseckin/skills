import { describe, expect, it } from "bun:test";
import { assertCriticIndependent } from "../../../olt/scripts/src/workflow/completion/critic-identity.ts";
import { generateStructuredFindingsFromCritic } from "../../../olt/scripts/src/workflow/completion/critic-feedback-loop.ts";
import type { WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";

describe("Critic Feedback Loop & Independence", () => {
  it("passes independence check when critic has no conflicting task assignments", () => {
    const state: WorkflowState = {
      tasks: {},
      gates: [],
      commands: {},
      runs: {},
    } as unknown as WorkflowState;
    expect(() => assertCriticIndependent(state, "independent-critic")).not.toThrow();
  });

  it("extracts structured findings from critic review object", () => {
    const review = {
      status: "findings",
      findings: [
        {
          id: "f-1",
          finding_type: "deficiency",
          severity: "critical",
          statement: "Unresolved requirement",
        },
      ],
    };
    const structured = generateStructuredFindingsFromCritic(review);
    expect(structured.length).toBe(1);
    expect(structured[0].id).toBe("f-1");
  });

  it("handles null or non-object reviews safely", () => {
    expect(generateStructuredFindingsFromCritic(null)).toEqual([]);
    expect(generateStructuredFindingsFromCritic(undefined)).toEqual([]);
    expect(generateStructuredFindingsFromCritic("invalid")).toEqual([]);
  });
});
