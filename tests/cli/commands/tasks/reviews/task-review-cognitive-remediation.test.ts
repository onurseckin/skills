import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../../../olt/scripts/src/core/errors/index.ts";

describe("task:review cognitive error format", () => {
  it("rewrites cognitive deepening error with full runnable command", () => {
    const taskId = "task-alpha";
    const validator = "val-bob";
    const baseError = new HarnessError(
      "INVALID_STATE",
      `Cannot finalize review for task '${taskId}': Cognitive deepening protocol not satisfied. Completed 0/5 required cognitive rounds. Run \`task:probe --task ${taskId} --kind cognitive\` to satisfy cognitive deepening.`,
    );

    const demand = `Cognitive review demand for task ${taskId}`;
    const cmd = `task:probe --task ${taskId} --kind cognitive --validator ${validator} --demand "${demand}"`;
    const updatedMessage = baseError.message.replace(
      /Run `[^`]+` to satisfy cognitive deepening\./,
      `Run \`${cmd}\` to satisfy cognitive deepening.`,
    );

    expect(updatedMessage).toContain(`Run \`${cmd}\` to satisfy cognitive deepening.`);
    expect(updatedMessage).toContain("--validator val-bob");
    expect(updatedMessage).toContain(`--demand "Cognitive review demand for task ${taskId}"`);
  });
});
