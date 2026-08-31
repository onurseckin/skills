import { describe, expect, test } from "bun:test";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";

describe("CLI execute dispatcher", () => {
  test("throws on unknown command", async () => {
    await expect(execute(["non-existent-cmd"])).rejects.toThrow(
      "unknown command: non-existent-cmd",
    );
  });

  test("routes space-separated sub-commands deductively to colon syntax", async () => {
    const result = await execute(["role", "list"]);
    expect(result).toBeDefined();
    expect(result.roles).toBeDefined();
  });

  test("provides nearest command suggestion on typo", async () => {
    await expect(execute(["role:lst"])).rejects.toThrow(
      "unknown command: role:lst; did you mean 'role:list'?",
    );
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
