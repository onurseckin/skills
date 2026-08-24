import { describe, it, expect } from "bun:test";
import { assertValidReviewer } from "../../../olt/scripts/src/cli/commands/task-review.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import type { TaskRecord } from "../../../olt/scripts/src/workflow/types.ts";

describe("assertValidReviewer", () => {
  it("rejects reviews from unassigned agents", () => {
    const task = {
      id: "task-1",
      lease: { agent_id: "impl-1", paired_validator_id: "val-1" },
    } as unknown as TaskRecord;

    expect(() => {
      assertValidReviewer("val-impostor", task);
    }).toThrow(HarnessError);
  });

  it("permits review from the assigned paired validator", () => {
    const task = {
      id: "task-1",
      lease: { agent_id: "impl-1", paired_validator_id: "val-1" },
    } as unknown as TaskRecord;

    expect(() => {
      assertValidReviewer("val-1", task);
    }).not.toThrow();
  });
});
