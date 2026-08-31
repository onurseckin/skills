import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import { cleanupRoots } from "../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../fixtures/task-ops-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("doctor command", () => {
  test("runs doctor check on a compiled run and returns structured report", async () => {
    const { run } = await setupCompiledRun("doctor-basic", roots);
    const result = await execute(["doctor", "--run", run]);

    expect(result.run_root).toBe(run);
    expect(typeof result.markdown).toBe("string");
    expect(String(result.markdown)).toContain("### Capsule Doctor:");
  });

  test("runs doctor:verify to assert invariants", async () => {
    const { run } = await setupCompiledRun("doctor-verify", roots);
    const result = await execute(["doctor:verify", "--run", run]);

    expect(result.run_root).toBe(run);
    expect(result.markdown).toBeDefined();
  });
});

describe("health command", () => {
  test("runs health command on default scripts directory with check filter", async () => {
    const result = await execute(["health", "--check", "vendor-identifiers"]);
    expect(result.healthy).toBeDefined();
    expect(result.markdown).toBeDefined();
  });

  test("rejects invalid --check option with known error", async () => {
    await expect(execute(["health", "--check", "invalid-check"])).rejects.toThrow(
      "unknown --check",
    );
  });
});

describe("doctor:repair command", () => {
  test("repairs projection and returns repaired state summary", async () => {
    const { run } = await setupCompiledRun("doctor-repair", roots);
    const result = await execute([
      "doctor:repair",
      "--run",
      run,
      "--actor",
      "coordinator",
    ]);

    expect(result.run_root).toBe(run);
    expect(String(result.markdown)).toContain("### Projection Repaired");
  });
});
