import { describe, expect, it } from "bun:test";
import { reportsLayout } from "../../../olt/scripts/src/engine/store/layout/layout-reports.ts";

describe("Workspace Layout: Reports Directory & Report Structures", () => {
  it("returns empty issues when reports directory does not exist", () => {
    const issues = reportsLayout("/tmp/nonexistent-run-root-reports", { tasks: {} });
    expect(issues.length).toBe(0);
  });

  it("handles undefined state without error", () => {
    const issues = reportsLayout("/tmp/nonexistent-run-root-reports", undefined);
    expect(issues.length).toBe(0);
  });
});
