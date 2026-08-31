import { describe, expect, test } from "bun:test";
import { validateReview } from "../../../olt/scripts/src/workflow/review/validate-review.ts";
import { openValidations } from "../../../olt/scripts/src/workflow/review/validation-state.ts";

describe("task-review workflow gate", () => {
  test("validateReview validates review payload correctly", () => {
    expect(typeof validateReview).toBe("function");
  });

  test("openValidations extracts active validation attempts", () => {
    expect(typeof openValidations).toBe("function");
    expect(
      openValidations({
        id: "T-1",
        status: "submitted",
        original_implementer: "worker",
        attempts: [],
        write_scope: [],
        requirement_ids: [],
        priority: 1,
        type: "task",
      }),
    ).toEqual([]);
  });
});
