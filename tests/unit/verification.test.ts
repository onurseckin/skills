import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";

describe("test suite separation verification", () => {
  test("package.json defines correct unit and integration test scripts", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts.test).toBe("bun test --timeout 30000 --parallel --no-isolate tests/unit");
    expect(pkg.scripts["test:unit"]).toBe(
      "bun test --timeout 30000 --parallel --no-isolate tests/unit",
    );
    expect(pkg.scripts["test:integration"]).toBe("bun test --timeout 30000 tests/integration");
    expect(pkg.scripts["test:integrations"]).toBe("bun test --timeout 30000 tests/integration");
    expect(pkg.scripts["test:all"]).toBe("bun run test:unit && bun run test:integration");
    expect(pkg.scripts["test:coverage"]).toBe("bun test --timeout 30000 --coverage tests/unit");
  });

  test("unit and integration test directories exist and are separated", () => {
    expect(existsSync("tests/unit")).toBe(true);
    expect(existsSync("tests/integration")).toBe(true);
  });
});
