import { describe, expect, test } from "bun:test";
import { execute } from "../../olt/scripts/src/cli/execute.ts";
import { executePreActionHook } from "../../olt/scripts/src/sentinel/index.ts";

describe("sentinel:pre-action hook", () => {
  test("allows implementer writing within leased write scope", () => {
    const result = executePreActionHook({
      agent_id: "impl_01",
      role: "implementer",
      action_type: "file_write",
      target: "src/utils/math.ts",
      write_scope: ["src/utils/math.ts", "tests/utils/math.test.ts"],
    });

    expect(result.allowed).toBe(true);
  });

  test("blocks implementer writing outside leased write scope", () => {
    const result = executePreActionHook({
      agent_id: "impl_01",
      role: "implementer",
      action_type: "file_write",
      target: "src/engine/secrets.ts",
      write_scope: ["src/utils/math.ts"],
    });

    expect(result.allowed).toBe(false);
    expect(result.code).toBe("PATH_SAFETY_VIOLATION");
    expect(result.reason).toContain("outside the leased write scope");
  });

  test("blocks cognitive validator attempting terminal shell command", () => {
    const result = executePreActionHook({
      agent_id: "val_01",
      role: "validator",
      action_type: "shell_command",
      target: "bun test tests/utils/math.test.ts",
    });

    expect(result.allowed).toBe(false);
    expect(result.code).toBe("ROLE_BOUNDARY_DEVIATION");
    expect(result.reason).toContain("restricted from executing terminal commands");
  });

  test("blocks coordinator attempting file write", () => {
    const result = executePreActionHook({
      agent_id: "coord_01",
      role: "coordinator",
      action_type: "file_write",
      target: "src/core/main.ts",
    });

    expect(result.allowed).toBe(false);
    expect(result.code).toBe("ROLE_BOUNDARY_DEVIATION");
    expect(result.reason).toContain("does not hold file write privileges");
  });

  test("blocks detached background subshells with rogue tokens", () => {
    const result = executePreActionHook({
      agent_id: "impl_01",
      role: "implementer",
      action_type: "shell_command",
      target: "nohup bun run server.ts &",
    });

    expect(result.allowed).toBe(false);
    expect(result.code).toBe("ROGUE_PROCESS_ANCESTRY");
    expect(result.reason).toContain("Detached processes and unmonitored background subshells");
  });

  test("CLI execute sentinel:pre-action successfully allows valid tool call", async () => {
    const res = await execute([
      "sentinel:pre-action",
      "--role",
      "implementer",
      "--agent",
      "impl_01",
      "--target",
      "src/foo.ts",
      "--write-scope",
      "src/foo.ts",
    ]);

    expect(res.allowed).toBe(true);
    expect(res.agent_id).toBe("impl_01");
  });

  test("CLI execute sentinel:pre-action blocks unauthorized calls with exit code 1", async () => {
    try {
      await execute([
        "sentinel:pre-action",
        "--role",
        "validator",
        "--agent",
        "val_01",
        "--action",
        "shell_command",
        "--target",
        "bun test",
      ]);
      expect(true).toBe(false);
    } catch (error: unknown) {
      const err = error as { code: string; exitCode: number };
      expect(err.code).toBe("ROLE_BOUNDARY_DEVIATION");
      expect(err.exitCode).toBe(1);
    }
  });
});
