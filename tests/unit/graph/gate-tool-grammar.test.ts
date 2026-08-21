import { describe, expect, test } from "bun:test";
import { verificationToolCommandIsStrong } from "../../../orchestrating-long-tasks/scripts/src/graph/gate-tool-grammar.ts";

// verificationToolCommandIsStrong is gate-command-policy's last-resort classifier: it only sees a
// command after gate-argv-policy and gate-runtime-grammar have both declined an opinion. These
// tests drive it directly with its own contract (executable, argv) rather than through the full
// gate-command grammar, since that path is already exercised end-to-end by
// gate-command-grammar.test.ts; this file exists to reach the family-specific branches inside
// verificationToolCommandIsStrong itself.
describe("verificationToolCommandIsStrong", () => {
  test("git: only `diff --check`, optionally against the staged index, counts as strong", () => {
    expect(verificationToolCommandIsStrong("git", ["git", "diff", "--check"])).toBe(true);
    expect(verificationToolCommandIsStrong("git", ["git", "diff", "--cached", "--check"])).toBe(
      true,
    );
    expect(verificationToolCommandIsStrong("git", ["git", "diff"])).toBe(false);
    expect(verificationToolCommandIsStrong("git", ["git", "status"])).toBe(false);
    expect(
      verificationToolCommandIsStrong("git", ["git", "diff", "--check", "--cached", "HEAD"]),
    ).toBe(false);
  });

  test("cargo test requires an explicit target flag, not just the bare subcommand", () => {
    expect(verificationToolCommandIsStrong("cargo", ["cargo", "test", "--workspace"])).toBe(true);
    expect(verificationToolCommandIsStrong("cargo", ["cargo", "test", "--lib"])).toBe(true);
    expect(verificationToolCommandIsStrong("cargo", ["cargo", "test", "--package=core"])).toBe(
      true,
    );
    expect(verificationToolCommandIsStrong("cargo", ["cargo", "test"])).toBe(false);
    expect(verificationToolCommandIsStrong("cargo", ["cargo", "test", "some_filter"])).toBe(false);
    expect(verificationToolCommandIsStrong("cargo", ["cargo", "metadata"])).toBe(false);
    // cargo test's target grammar accepts only flags, never a positional package/test filter —
    // even alongside an otherwise-accepted --workspace flag, a bare trailing word is rejected.
    expect(
      verificationToolCommandIsStrong("cargo", ["cargo", "test", "--workspace", "extra_target"]),
    ).toBe(false);
  });

  test("go test requires flags, not a filter operand, and dotnet test accepts the bare subcommand", () => {
    expect(verificationToolCommandIsStrong("go", ["go", "test", "./..."])).toBe(true);
    expect(verificationToolCommandIsStrong("go", ["go", "env"])).toBe(false);
    expect(verificationToolCommandIsStrong("dotnet", ["dotnet", "test"])).toBe(true);
    expect(verificationToolCommandIsStrong("dotnet", ["dotnet", "--info"])).toBe(false);
  });

  test("vitest requires the run subcommand and an explicit file target", () => {
    expect(verificationToolCommandIsStrong("vitest", ["vitest", "run", "tests/a.test.ts"])).toBe(
      true,
    );
    expect(verificationToolCommandIsStrong("vitest", ["vitest", "tests/a.test.ts"])).toBe(false);
    expect(verificationToolCommandIsStrong("vitest", ["vitest", "run"])).toBe(false);
  });

  test("jest and the pytest/unittest family accept a bare target without a run subcommand", () => {
    expect(verificationToolCommandIsStrong("jest", ["jest", "tests/a.test.ts"])).toBe(true);
    expect(verificationToolCommandIsStrong("jest", ["jest"])).toBe(false);
    expect(verificationToolCommandIsStrong("pytest", ["pytest", "-q", "tests"])).toBe(true);
  });

  test("lint tools: biome needs its own check subcommand, eslint and oxlint do not", () => {
    expect(verificationToolCommandIsStrong("biome", ["biome", "check", "src"])).toBe(true);
    expect(verificationToolCommandIsStrong("biome", ["biome", "src"])).toBe(false);
    expect(verificationToolCommandIsStrong("eslint", ["eslint", "src/a.ts"])).toBe(true);
    expect(verificationToolCommandIsStrong("oxlint", ["oxlint", "src"])).toBe(true);
  });

  test("formatters require --check and a target", () => {
    expect(verificationToolCommandIsStrong("prettier", ["prettier", "--check", "src"])).toBe(true);
    expect(verificationToolCommandIsStrong("prettier", ["prettier", "--write", "src"])).toBe(false);
    expect(verificationToolCommandIsStrong("oxfmt", ["oxfmt", "src"])).toBe(false);
  });

  test("tsc requires --noEmit among its flags", () => {
    expect(verificationToolCommandIsStrong("tsc", ["tsc", "--noEmit"])).toBe(true);
    expect(verificationToolCommandIsStrong("tsc", ["tsc", "-p", "tsconfig.json"])).toBe(false);
  });

  test("package managers accept build/lint/test bare, or `run <script>` for a safe script name", () => {
    expect(verificationToolCommandIsStrong("npm", ["npm", "test"])).toBe(true);
    expect(verificationToolCommandIsStrong("npm", ["npm", "run", "lint"])).toBe(true);
    expect(verificationToolCommandIsStrong("npm", ["npm", "run", "env"])).toBe(false);
    expect(verificationToolCommandIsStrong("npm", ["npm", "run"])).toBe(false);
    expect(verificationToolCommandIsStrong("pnpm", ["pnpm", "test"])).toBe(true);
    expect(verificationToolCommandIsStrong("yarn", ["yarn", "build"])).toBe(true);

    // No family listed above claims "custom-check"; it falls through to the repository-local
    // executable check, which requires a path separator and rejects dash-prefixed arguments.
    expect(verificationToolCommandIsStrong("custom-check", ["custom-check", "src/check.ts"])).toBe(
      false,
    );
    expect(
      verificationToolCommandIsStrong("scripts/check", ["scripts/check", "src/check.ts"]),
    ).toBe(true);
    expect(verificationToolCommandIsStrong("scripts/check", ["scripts/check", "--flag"])).toBe(
      false,
    );
  });
});
