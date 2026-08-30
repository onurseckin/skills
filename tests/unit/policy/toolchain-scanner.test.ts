import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  scanRepositoryToolchain,
  synthesizeCalibratedRepoPolicy,
} from "../../../olt/scripts/src/policy/generator/index.ts";

describe("Autonomous Toolchain Scanner & Policy Calibration", () => {
  it("scans a standard Bun repository with package.json scripts", () => {
    const testDir = join(tmpdir(), `test-toolchain-bun-${Date.now()}`);
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

    try {
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
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("scans a Turbo monorepo and calibrates monorepo tools", () => {
    const testDir = join(tmpdir(), `test-toolchain-turbo-${Date.now()}`);
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

    try {
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
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("scans a Cargo repository and synthesizes Rust policy", () => {
    const testDir = join(tmpdir(), `test-toolchain-cargo-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "Cargo.toml"), '[package]\nname = "test-crate"');

    try {
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
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});
