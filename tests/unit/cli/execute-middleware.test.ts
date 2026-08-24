import { describe, it, expect, mock } from "bun:test";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";

describe("execute universal middleware", () => {
  it("blocks task commands if planning phase has no compiled tasks", async () => {
    mock.module("../../../olt/scripts/src/engine/store/load.ts", () => {
      return {
        loadRun: () => ({ state: { requirements: {}, tasks: {} } }),
      };
    });

    try {
      await execute(["task:claim", "--run", ".", "--task", "task-1"]);
      expect(true).toBe(false); // Should not reach here
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(HarnessError);
      if (e instanceof HarnessError) {
        expect(e.code).toBe("INVALID_STATE");
        expect(e.message).toContain("Cumulative Phase Invariant Violation");
      }
    }
  });
});
