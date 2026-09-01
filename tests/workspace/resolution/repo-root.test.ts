import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { findRepoRoot } from "../../../olt/scripts/src/core/shared/paths.ts";

describe("Workspace Resolution: Sovereign Repo Root", () => {
  it("locates repo root from current working directory", () => {
    const root = findRepoRoot(process.cwd());
    expect(typeof root).toBe("string");
    expect(root.length).toBeGreaterThan(0);
    expect(root.endsWith("skills") || root.includes("skills")).toBe(true);
  });

  it("locates repo root from deeply nested subdirectories", () => {
    const nested = join(process.cwd(), "olt", "scripts", "src", "core");
    const root = findRepoRoot(nested);
    expect(root).toBe(findRepoRoot(process.cwd()));
  });

  it("throws PATH_SAFETY HarnessError when no root anchor exists", () => {
    expect(() => {
      findRepoRoot("/tmp");
    }).toThrow();
  });
});
