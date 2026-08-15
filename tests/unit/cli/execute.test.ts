import { describe, expect, test } from "bun:test";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";

describe("CLI execute dispatcher", () => {
  test("throws on unknown command", async () => {
    await expect(execute(["non-existent-cmd"])).rejects.toThrow("unknown command: non-existent-cmd");
  });

  test("throws when non-run command receives trailing -- remainder arguments", async () => {
    await expect(
      execute(["plan:status", "--run", "some-run", "--", "extra", "args"]),
    ).rejects.toThrow("command plan:status does not accept -- arguments");

    await expect(
      execute(["task:claim", "--run", "some-run", "--task", "t1", "--agent", "a1", "--", "extra"]),
    ).rejects.toThrow("command task:claim does not accept -- arguments");
  });
});
