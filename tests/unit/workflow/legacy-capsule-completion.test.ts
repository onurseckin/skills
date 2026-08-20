import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { completionReviewIssues } from "../../../orchestrating-long-tasks/scripts/src/workflow/completion/review-issues.ts";
import type { WorkflowState } from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";

const CAPSULE = join(
  import.meta.dir,
  "../../../.capsules/2026-08-17-skills-documentation-elevation",
);

describe("a capsule written before the proof and digest changes", () => {
  test("still loads, and its recorded proofs are still readable", () => {
    expect(existsSync(CAPSULE)).toBeTrue();
    const state = loadRun(CAPSULE).state as unknown as WorkflowState;
    const review = state.completion_review!;

    expect(review.requirement_proofs.length).toBeGreaterThan(0);
    // The legacy shape carried a blank packet digest; it survives as recorded rather than being
    // rewritten, and none of its proofs is reinterpreted as unproven.
    expect(review.packet_sha256).toBe("");
    expect(review.requirement_proofs.map((proof) => proof.status)).not.toContain("unproven");
    expect(
      completionReviewIssues(state, review).filter((issue) => issue.includes("unproven")),
    ).toEqual([]);
  });
});
