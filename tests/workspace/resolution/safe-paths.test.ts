import { describe, expect, it } from "bun:test";
import { safeRepoPath } from "../../../olt/scripts/src/core/paths.ts";

describe("Workspace Resolution: Safe Repo Paths & Traversal Defense", () => {
  const repoRoot = process.cwd();

  it("resolves legitimate relative subpaths", () => {
    const p1 = safeRepoPath(repoRoot, "package.json");
    expect(p1.endsWith("package.json")).toBe(true);

    const p2 = safeRepoPath(repoRoot, "olt/scripts/src/core/paths.ts");
    expect(p2.endsWith("paths.ts")).toBe(true);
  });

  it("rejects absolute paths", () => {
    expect(() => {
      safeRepoPath(repoRoot, "/etc/passwd");
    }).toThrow();
  });

  it("rejects parent directory traversals", () => {
    expect(() => {
      safeRepoPath(repoRoot, "../secret.txt");
    }).toThrow();

    expect(() => {
      safeRepoPath(repoRoot, "sub/../../secret.txt");
    }).toThrow();
  });

  it("rejects non-directory repo roots", () => {
    expect(() => {
      safeRepoPath("/dev/null/nonexistent", "test.txt");
    }).toThrow();
  });
});
