import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

describe("the project has one default test lane and an explicit on-demand full lane", () => {
  test("package.json exposes a single default test script pointed at tests/unit", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string | undefined>;
    };
    expect(pkg.scripts.test).toBe("bun scripts/testing/test-runner.ts tests/unit");
    expect(pkg.scripts["test:coverage"]).toBe(
      "bun scripts/testing/test-runner.ts --coverage tests/unit",
    );
    expect(pkg.scripts["test:all"]).toBe("bun scripts/testing/test-runner.ts tests");
  });

  test("no duplicate default-lane script survives", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string | undefined>;
    };
    for (const removed of ["test:unit", "test:integration", "test:integrations"]) {
      expect(pkg.scripts[removed]).toBeUndefined();
    }
  });

  test("tests/unit is the default lane, tests/integration is the explicit full-run lane", () => {
    expect(existsSync("tests/unit")).toBe(true);
    expect(existsSync("tests/integration")).toBe(true);
  });
});
