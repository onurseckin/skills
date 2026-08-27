import { describe, expect, test } from "bun:test";
import {
  appendReleaseFailureWarning,
  resolvePhaseCompletionResult,
} from "../../../olt/scripts/src/cli/commands/run-ops.ts";

describe("runCompleteCommand", () => {
  test("captures rejected phase completion as a structured release failure", async () => {
    const result = await resolvePhaseCompletionResult(async () => {
      throw new Error("sync service unavailable");
    });

    expect(result).toEqual({
      synced: false,
      committed: false,
      pushed: false,
      error: "sync service unavailable",
    });
  });

  test("renders release failures as a concise completion warning", () => {
    expect(appendReleaseFailureWarning("### Run Complete", "sync service unavailable")).toBe(
      "### Run Complete\n- **Warning**: Release completion failed: sync service unavailable",
    );
  });
});
