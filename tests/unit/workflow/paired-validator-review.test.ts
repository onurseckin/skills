import { describe, it, expect } from "bun:test";
import { assertValidReviewer } from "../../../olt/scripts/src/cli/commands/task-review.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";

describe("assertValidReviewer", () => {
  it("rejects reviews from unassigned agents", () => {
    const task = {
      id: "task-1",
      lease: { agent_id: "impl-1", paired_validator_id: "val-1" },
    };

    expect(() => {
      assertValidReviewer("val-impostor", task as any);
    }).toThrow(HarnessError);
  });

  it("permits review from the assigned paired validator", () => {
    const task = {
      id: "task-1",
      lease: { agent_id: "impl-1", paired_validator_id: "val-1" },
    };

    expect(() => {
      assertValidReviewer("val-1", task as any);
    }).not.toThrow();
  });
});
