import { describe, it, expect } from "bun:test";
import { RootDirectoryHygieneGuard } from "../../../olt/scripts/src/authority/root-hygiene-guard.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";

describe("RootDirectoryHygieneGuard", () => {
  const repoRoot = "/Users/foo/repos/skills";

  it("blocks writing ad-hoc scratch scripts in root with absolute and relative paths", () => {
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

    expect(() => {
      RootDirectoryHygieneGuard.assertAllowedWritePath(repoRoot, "scratch_file.js");
    }).toThrow(HarnessError);

    try {
      RootDirectoryHygieneGuard.assertAllowedWritePath(repoRoot, "random_file.ts");
    } catch (err: unknown) {
      expect(err instanceof HarnessError).toBe(true);
      expect((err as HarnessError).code).toBe("PATH_SAFETY");
      expect((err as HarnessError).message).toContain("[ROOT_HYGIENE_VIOLATION]");
    }
  });

  it("allows writing inside scratch/ directory or subdirectories", () => {
    expect(() => {
      RootDirectoryHygieneGuard.assertAllowedWritePath(
        repoRoot,
        "/Users/foo/repos/skills/scratch/fix_state.ts",
      );
    }).not.toThrow();

    expect(() => {
      RootDirectoryHygieneGuard.assertAllowedWritePath(repoRoot, "scratch/nested/test.ts");
    }).not.toThrow();

    expect(() => {
      RootDirectoryHygieneGuard.assertAllowedWritePath(repoRoot, "src/authority/module.ts");
    }).not.toThrow();

    expect(() => {
      RootDirectoryHygieneGuard.assertAllowedWritePath(repoRoot, "subdir\\windows_path.ts");
    }).not.toThrow();
  });

  it("allows writing all recognized project root configuration files", () => {
    const allowedFiles = [
      "package.json",
      "tsconfig.json",
      "AGENTS.md",
      "README.md",
      "GEMINI.md",
      "lefthook.yml",
      ".gitignore",
      "bun.lock",
      "bun.lockb",
      ".editorconfig",
      ".oxfmtrc.json",
      "eslint.config.js",
      ".prettierrc",
    ];

    for (const file of allowedFiles) {
      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(repoRoot, `${repoRoot}/${file}`);
      }).not.toThrow();

      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(repoRoot, file);
      }).not.toThrow();
    }
  });

  it("can be instantiated without errors", () => {
    const guard = new RootDirectoryHygieneGuard();
    expect(guard).toBeDefined();
  });
});
