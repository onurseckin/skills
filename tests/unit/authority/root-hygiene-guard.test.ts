import { describe, it, expect } from "bun:test";
import { RootDirectoryHygieneGuard } from "../../../olt/scripts/src/authority/root-hygiene-guard.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";

describe("RootDirectoryHygieneGuard", () => {
  const repoRoot = "/Users/foo/repos/skills";

  it("blocks writing ad-hoc scratch scripts in root", () => {
    expect(() => {
      RootDirectoryHygieneGuard.assertAllowedWritePath(
        repoRoot,
        "/Users/foo/repos/skills/fix_state.ts",
      );
    }).toThrow(HarnessError);

    expect(() => {
      RootDirectoryHygieneGuard.assertAllowedWritePath(
        repoRoot,
        "/Users/foo/repos/skills/patch.cjs",
      );
    }).toThrow(HarnessError);
  });

  it("allows writing inside scratch/ directory", () => {
    expect(() => {
      RootDirectoryHygieneGuard.assertAllowedWritePath(
        repoRoot,
        "/Users/foo/repos/skills/scratch/fix_state.ts",
      );
    }).not.toThrow();
  });

  it("allows writing recognized project root configuration files", () => {
    expect(() => {
      RootDirectoryHygieneGuard.assertAllowedWritePath(
        repoRoot,
        "/Users/foo/repos/skills/package.json",
      );
    }).not.toThrow();
  });
});
