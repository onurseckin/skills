import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

describe("the project has one test lane", () => {
  test("package.json exposes a single test script pointed at tests/unit", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string | undefined>;
    };
    expect(pkg.scripts.test).toBe("bun test --timeout 30000 --parallel --no-isolate tests/unit");
    expect(pkg.scripts["test:coverage"]).toBe(
      "bun test --timeout 30000 --parallel --no-isolate --coverage tests/unit",
    );
  });

  test("no separate lane script survives", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string | undefined>;
    };
    for (const removed of ["test:unit", "test:integration", "test:integrations", "test:all"]) {
      expect(pkg.scripts[removed]).toBeUndefined();
    }
  });

  test("tests live only under tests/unit", () => {
    expect(existsSync("tests/unit")).toBe(true);
    expect(existsSync("tests/integration")).toBe(false);
  });
});
