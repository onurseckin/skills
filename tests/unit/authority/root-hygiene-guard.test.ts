import { describe, it, expect } from "bun:test";
import { RootDirectoryHygieneGuard } from "../../../olt/scripts/src/authority/guards/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("RootDirectoryHygieneGuard", () => {
  const repoRoot = "/Users/foo/repos/skills";

  it("blocks writing ad-hoc scratch scripts in root with absolute and relative paths", () => {
    const unallowedFiles = ["fix_state.ts", "patch.cjs", "scratch_file.js", "random_file.ts"];

    for (const file of unallowedFiles) {
      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(repoRoot, `${repoRoot}/${file}`);
      }).toThrow(HarnessError);

      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(repoRoot, file);
      }).toThrow(HarnessError);

      try {
        RootDirectoryHygieneGuard.assertAllowedWritePath(repoRoot, file);
      } catch (err: unknown) {
        expect(err instanceof HarnessError).toBe(true);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("PATH_SAFETY");
        expect(harnessErr.message).toContain("[ROOT_HYGIENE_VIOLATION]");
        expect(harnessErr.message).toContain(
          `Cannot create loose scratch file '${file}' in repository root.`,
        );
      }
    }
  });

  it("blocks writing in loose top-level directories outside ALLOWED_ROOT_DIRS", () => {
    const unallowedDirs = [
      "capsules/34-my-run",
      ".capsules/run-1",
      "34-repository-root-hygiene-guard/manifest.json",
      "temp/debug.log",
      "tmp/out.txt",
      "loose_scratch/script.ts",
      "custom_dir/file.ts",
      "scratch_custom/test.ts",
    ];

    for (const dirPath of unallowedDirs) {
      const parts = dirPath.split("/");
      const topDir = parts.length > 0 && typeof parts[0] === "string" ? parts[0] : "";

      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(repoRoot, `${repoRoot}/${dirPath}`);
      }).toThrow(HarnessError);

      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(repoRoot, dirPath);
      }).toThrow(HarnessError);

      try {
        RootDirectoryHygieneGuard.assertAllowedWritePath(repoRoot, dirPath);
      } catch (err: unknown) {
        expect(err instanceof HarnessError).toBe(true);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("PATH_SAFETY");
        expect(harnessErr.message).toContain("[ROOT_HYGIENE_VIOLATION]");
        expect(harnessErr.message).toContain(
          `Cannot create loose directory '${topDir}' in repository root.`,
        );
        expect(harnessErr.message).toContain(
          "All temporary scripts, patches, and logs MUST reside in 'scratch/' or '.olt/scratch/', and capsule runs MUST reside in '.olt/capsules/'.",
        );
      }
    }
  });

  it("blocks writing in loose directories with Windows backslashes", () => {
    const windowsPaths = [
      "capsules\\34-my-run",
      "temp\\debug.log",
      "tmp\\out.txt",
      "custom_dir\\nested\\file.ts",
    ];

    for (const winPath of windowsPaths) {
      const parts = winPath.split("\\");
      const topDir = parts.length > 0 && typeof parts[0] === "string" ? parts[0] : "";

      try {
        RootDirectoryHygieneGuard.assertAllowedWritePath(repoRoot, winPath);
      } catch (err: unknown) {
        expect(err instanceof HarnessError).toBe(true);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("PATH_SAFETY");
        expect(harnessErr.message).toContain(
          `Cannot create loose directory '${topDir}' in repository root.`,
        );
      }
    }
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
      "LICENSE",
      "bunfig.toml",
      ".capture.yaml",
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

  it("allows writing inside all designated allowed directories", () => {
    const allowedPaths = [
      "scratch/fix_state.ts",
      "scratch/nested/test.ts",
      ".scratch/temp_run.json",
      ".olt/scratch/debug.log",
      ".olt/capsules/34-run/state.json",
      "olt/scripts/src/authority/root-hygiene-guard.ts",
      "tests/unit/authority/root-hygiene-guard.test.ts",
      "docs/architecture.md",
      "scripts/build.ts",
      "coverage/lcov.info",
      ".coverage/coverage.json",
      "node_modules/.cache/test.json",
      ".git/config",
      ".github/workflows/ci.yml",
      ".tmp/run.tmp",
      ".locks/task.lock",
    ];

    for (const path of allowedPaths) {
      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(repoRoot, `${repoRoot}/${path}`);
      }).not.toThrow();

      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(repoRoot, path);
      }).not.toThrow();
    }
  });

  it("allows writing inside allowed directories using Windows separators", () => {
    expect(() => {
      RootDirectoryHygieneGuard.assertAllowedWritePath(repoRoot, "scratch\\nested\\test.ts");
    }).not.toThrow();

    expect(() => {
      RootDirectoryHygieneGuard.assertAllowedWritePath(repoRoot, "olt\\scripts\\src\\module.ts");
    }).not.toThrow();

    expect(() => {
      RootDirectoryHygieneGuard.assertAllowedWritePath(repoRoot, ".olt\\scratch\\temp.log");
    }).not.toThrow();
  });

  it("can be instantiated without errors", () => {
    const guard = new RootDirectoryHygieneGuard();
    expect(guard).toBeDefined();
  });
});
