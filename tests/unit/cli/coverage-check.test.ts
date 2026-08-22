import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("bunfig coverage threshold", () => {
  test("bunfig.toml defines non-blocking coverage threshold", () => {
    const content = readFileSync("bunfig.toml", "utf8");
    const match = content.match(/coverageThreshold\s*=\s*([\d.]+)/);
    expect(match).toBeTruthy();
    const threshold = parseFloat(match![1]!);
    expect(threshold).toBeLessThanOrEqual(0.5);
  });
});
