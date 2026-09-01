import { describe, expect, it } from "bun:test";
import { HarnessError, normalizeError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("Error Normalization Handler", () => {
  it("normalizes HarnessError with custom fix and footers", () => {
    const harnessErr = new HarnessError(
      "INVALID_STATE",
      "Task not claimable",
      ["issue-1"],
      3,
      "Use valid task",
    );
    const normalized = normalizeError(harnessErr);
    expect(normalized.code).toBe("INVALID_STATE");
    expect(normalized.message).toBe("Task not claimable");
    expect(normalized.fix).toBe("Use valid task");
    expect(normalized.footer).toContain("harness.ts explain INVALID_STATE");
  });

  it("normalizes standard Error and non-error values", () => {
    const stdErr = new Error("General boom");
    const normalizedStd = normalizeError(stdErr);
    expect(normalizedStd.code).toBe("INTERNAL");
    expect(normalizedStd.message).toBe("General boom");

    const nonErr = normalizeError("unknown failure");
    expect(nonErr.code).toBe("INTERNAL");
    expect(nonErr.message).toBe("Unknown internal failure");
  });
});
