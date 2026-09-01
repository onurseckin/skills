import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupVirtualPolicyFS, setupVirtualPolicyFS } from "../fixture.ts";
import {
  scanRepositoryToolchain,
  synthesizeCalibratedRepoPolicy,
} from "../../../olt/scripts/src/policy/generator/index.ts";

describe("Autonomous Toolchain Scanner & Policy Calibration", () => {
  const scratchBase = "/virtual/policy/toolchain/scanner";

  beforeEach(() => {
    setupVirtualPolicyFS();
  });

  afterEach(() => {
    cleanupVirtualPolicyFS();
  });

  it("scans a standard Bun repository with package.json scripts", () => {
    const testDir = join(scratchBase, "bun-test");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "bun.lock"), "");
    writeFileSync(
      join(testDir, "package.json"),
      JSON.stringify({
        name: "test-bun-app",
        scripts: {
          test: "bun test",
          "test:all": "bun test tests",
          typecheck: "tsc --noEmit",
          lint: "oxlint",
        },
      }),
    );
    writeFileSync(join(testDir, "tsconfig.json"), "{}");

    const analysis = scanRepositoryToolchain(testDir);
    expect(analysis.ecosystem).toBe("bun");
    expect(analysis.packageManager).toBe("bun");
    expect(analysis.testRunner.default_command).toBe("bun test");
    expect(analysis.testRunner.full_suite_command).toBe("bun test:all");
    expect(analysis.typecheckCommand).toBe("bun typecheck");
    expect(analysis.lintCommand).toBe("bun lint");
    expect(analysis.allowedCommands).toContain("bun test");
    expect(analysis.allowedCommands).toContain("bun typecheck");
    expect(analysis.allowedCommands).toContain("bun lint");

    const policy = synthesizeCalibratedRepoPolicy(testDir);
    expect(policy.ecosystem).toBe("bun");
    expect(policy.package_manager).toBe("bun");
    expect(policy.test_runner.default_command).toBe("bun test");
    expect(policy.typecheck_command).toBe("bun typecheck");
    expect(policy.lint_command).toBe("bun lint");
  });

  it("scans a Turbo monorepo and calibrates monorepo tools", () => {
    const testDir = join(scratchBase, "turbo-test");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "pnpm-lock.yaml"), "");
    writeFileSync(join(testDir, "turbo.json"), "{}");
    writeFileSync(
      join(testDir, "package.json"),
      JSON.stringify({
        name: "test-monorepo",
        workspaces: ["apps/*", "packages/*"],
        scripts: {
          test: "turbo run test",
          typecheck: "turbo run typecheck",
          lint: "turbo run lint",
        },
      }),
    );

    const analysis = scanRepositoryToolchain(testDir);
    expect(analysis.ecosystem).toBe("node");
    expect(analysis.packageManager).toBe("pnpm");
    expect(analysis.isMonorepo).toBe(true);
    expect(analysis.monorepoTool).toBe("turbo");
    expect(analysis.allowedCommands).toContain("turbo");
    expect(analysis.allowedCommands).toContain("turbo run");
    expect(analysis.allowedCommands).toContain("pnpm run test");

    const policy = synthesizeCalibratedRepoPolicy(testDir);
    expect(policy.ecosystem).toBe("node");
    expect(policy.package_manager).toBe("pnpm");
    expect(policy.allowed_commands).toContain("turbo");
  });

  it("scans a Cargo repository and synthesizes Rust policy", () => {
    const testDir = join(scratchBase, "cargo-test");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "Cargo.toml"), '[package]\nname = "test-crate"');

    const analysis = scanRepositoryToolchain(testDir);
    expect(analysis.ecosystem).toBe("cargo");
    expect(analysis.packageManager).toBe("cargo");
    expect(analysis.testRunner.default_command).toBe("cargo test");
    expect(analysis.typecheckCommand).toBe("cargo check");
    expect(analysis.lintCommand).toBe("cargo clippy");

    const policy = synthesizeCalibratedRepoPolicy(testDir);
    expect(policy.ecosystem).toBe("cargo");
    expect(policy.test_runner.default_command).toBe("cargo test");
    expect(policy.typecheck_command).toBe("cargo check");
    expect(policy.lint_command).toBe("cargo clippy");
  });

  it("scans yarn repository with test:unit and check-types scripts", () => {
    const testDir = join(scratchBase, "yarn-test");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "yarn.lock"), "");
    writeFileSync(
      join(testDir, "package.json"),
      JSON.stringify({
        name: "test-yarn-app",
        scripts: {
          "test:unit": "jest",
          "check-types": "tsc",
          "check-lint": "eslint",
        },
      }),
    );

    const analysis = scanRepositoryToolchain(testDir);
    expect(analysis.ecosystem).toBe("node");
    expect(analysis.packageManager).toBe("yarn");
    expect(analysis.testRunner.default_command).toBe("yarn run test:unit");
    expect(analysis.typecheckCommand).toBe("yarn run check-types");
    expect(analysis.lintCommand).toBe("yarn run check-lint");
  });

  it("scans npm repository with package-lock.json, tsconfig fallback, and Turbo tasks format", () => {
    const testDir = join(scratchBase, "npm-test");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "package-lock.json"), "{}");
    writeFileSync(join(testDir, "tsconfig.json"), "{}");
    writeFileSync(join(testDir, "turbo.json"), JSON.stringify({ tasks: { build: {} } }));
    writeFileSync(
      join(testDir, "package.json"),
      JSON.stringify({
        name: "test-npm-app",
        scripts: {
          build: "next build",
        },
      }),
    );

    const analysis = scanRepositoryToolchain(testDir);
    expect(analysis.ecosystem).toBe("node");
    expect(analysis.packageManager).toBe("npm");
    expect(analysis.typecheckCommand).toBe("tsc --noEmit");
    expect(analysis.lintCommand).toBeUndefined();
  });
});
