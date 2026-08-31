import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverToolchainPolicy } from "../../olt/scripts/src/policy/index.ts";

describe("Autonomous Toolchain Analysis & Policy Calibration", () => {
  it("discovers bun, oxlint, and tsc toolchains from package.json", async () => {
    const testDir = join(
      tmpdir(),
      `test-toolchain-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    mkdirSync(testDir, { recursive: true });

    const pkg = {
      name: "sample-pkg",
      scripts: {
        typecheck: "tsc --noEmit",
        lint: "oxlint",
        test: "bun test",
        build: "turbo run build",
      },
      devDependencies: {
        oxlint: "^0.15.0",
        turbo: "^2.0.0",
        typescript: "^5.5.0",
      },
    };
    await Bun.write(join(testDir, "package.json"), JSON.stringify(pkg));

    try {
      const policy = discoverToolchainPolicy(testDir);
      expect(policy).toBeDefined();
      expect(policy.commands.typecheck).toBeDefined();
      expect(policy.commands.lint).toBeDefined();
      expect(policy.commands.test).toBeDefined();
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("handles missing package.json gracefully with safe defaults", () => {
    const testDir = join(
      tmpdir(),
      `test-toolchain-empty-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    mkdirSync(testDir, { recursive: true });

    try {
      const policy = discoverToolchainPolicy(testDir);
      expect(policy).toBeDefined();
      expect(policy.commands).toBeDefined();
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});
