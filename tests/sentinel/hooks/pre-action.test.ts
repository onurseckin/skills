import { describe, expect, test } from "bun:test";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { executePreActionHook } from "../../../olt/scripts/src/sentinel/index.ts";

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

  test("evaluates write scope boundary conditions across empty scopes and directory scopes", () => {
    // Empty write scope allows implementer writing without scope confinement
    const emptyScopeResult = executePreActionHook({
      agent_id: "impl_01",
      role: "implementer",
      action_type: "file_write",
      target: "src/arbitrary.ts",
      write_scope: [],
    });
    expect(emptyScopeResult.allowed).toBe(true);

    // Directory prefix scope allows file inside directory
    const dirScopeAllowed = executePreActionHook({
      agent_id: "impl_01",
      role: "implementer",
      action_type: "file_write",
      target: "src/utils/format.ts",
      write_scope: ["src/utils"],
    });
    expect(dirScopeAllowed.allowed).toBe(true);

    // Directory prefix scope blocks file in sibling directory
    const dirScopeBlocked = executePreActionHook({
      agent_id: "impl_01",
      role: "implementer",
      action_type: "file_write",
      target: "src/other/format.ts",
      write_scope: ["src/utils"],
    });
    expect(dirScopeBlocked.allowed).toBe(false);
    expect(dirScopeBlocked.code).toBe("PATH_SAFETY_VIOLATION");
  });

  test("blocks exact file prefix collision when target is sibling filename", () => {
    const result = executePreActionHook({
      agent_id: "impl_01",
      role: "implementer",
      action_type: "file_write",
      target: "src/utils/math_extra.ts",
      write_scope: ["src/utils/math.ts"],
    });

    expect(result.allowed).toBe(false);
    expect(result.code).toBe("PATH_SAFETY_VIOLATION");
  });

  test("blocks subshell and disown command evasion variants", () => {
    const disownResult = executePreActionHook({
      agent_id: "impl_01",
      role: "implementer",
      action_type: "shell_command",
      target: "python server.py disown",
    });
    expect(disownResult.allowed).toBe(false);
    expect(disownResult.code).toBe("ROGUE_PROCESS_ANCESTRY");

    const subshellResult = executePreActionHook({
      agent_id: "impl_01",
      role: "implementer",
      action_type: "shell_command",
      target: "sh -c 'node server.js' &",
    });
    expect(subshellResult.allowed).toBe(false);
    expect(subshellResult.code).toBe("ROGUE_PROCESS_ANCESTRY");

    const bypassResult = executePreActionHook({
      agent_id: "impl_01",
      role: "implementer",
      action_type: "shell_command",
      target: "LEFTHOOK=0 git commit -m 'skip verification'",
    });
    expect(bypassResult.allowed).toBe(false);
    expect(bypassResult.code).toBe("QUALITY_GATE_BYPASS_ATTEMPT");
  });

  test("CLI execute sentinel:pre-action blocks unauthorized calls with exit code 1", async () => {
    let didThrow = false;
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
    } catch (error: unknown) {
      didThrow = true;
      const err = error as { code: string; exitCode: number };
      expect(err.code).toBe("ROLE_BOUNDARY_DEVIATION");
      expect(err.exitCode).toBe(1);
    }
    expect(didThrow).toBe(true);
  });
});
