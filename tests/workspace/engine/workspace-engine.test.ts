import { describe, expect, it } from "bun:test";
import { findRepoRoot, resolveOltDir, resolveCapsulesDir, safeRepoPath } from "../resolution/index.ts";
import { CAPSULE_LAYOUT, checkManifest } from "../layout/index.ts";
import { withRunLock } from "../isolation/index.ts";

describe("Workspace Engine: End-to-End Integration & Lifecycle", () => {
  it("orchestrates sovereign root discovery, olt resolution, and capsule directory mapping", () => {
    const root = findRepoRoot();
    expect(root).toBeDefined();

    const oltDir = resolveOltDir(root);
    expect(oltDir.endsWith(".olt")).toBe(true);

    const capsulesDir = resolveCapsulesDir(root);
    expect(capsulesDir.includes("capsules")).toBe(true);

    const packagePath = safeRepoPath(root, "package.json");
    expect(packagePath.endsWith("package.json")).toBe(true);
  });

  it("coordinates lock acquisition with manifest validation checks", () => {
    const root = findRepoRoot();
    const result = withRunLock(root, () => {
      const manifestCheck = checkManifest(root);
      return { checked: true, issuesCount: manifestCheck.issues.length };
    });

    expect(result.checked).toBe(true);
    expect(typeof result.issuesCount).toBe("number");
  });

  it("verifies capsule layout entry count and primary anchors", () => {
    expect(CAPSULE_LAYOUT.length).toBeGreaterThan(5);
    const hasManifest = CAPSULE_LAYOUT.some((e) => e.name === "manifest.json");
    const hasEvents = CAPSULE_LAYOUT.some((e) => e.name === "events.jsonl");
    expect(hasManifest).toBe(true);
    expect(hasEvents).toBe(true);
  });
});
