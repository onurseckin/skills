import { describe, expect, it } from "bun:test";
import { isPathInRepoRoots } from "../../../../olt/scripts/src/mind/proposals/gates/predicates.ts";

describe("Mind Heuristics Safety & Damage Suite", () => {
  it("evaluates path safety relative to repository roots", () => {
    expect(isPathInRepoRoots("src/index.ts", ["src/"])).toBe(true);
    expect(isPathInRepoRoots("/etc/passwd", ["src/"])).toBe(false);
  });
});
