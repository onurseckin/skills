import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverToolchainPolicy } from "../../../olt/scripts/src/policy/index.ts";
import { cleanupVirtualDiscoveryFS, setupVirtualDiscoveryFS } from "../fixtures/index.ts";

describe("Autonomous Toolchain Analysis & Policy Calibration", () => {
  beforeEach(() => {
    setupVirtualDiscoveryFS();
  });

  afterEach(() => {
    cleanupVirtualDiscoveryFS();
  });

  it("discovers bun, oxlint, and tsc toolchains from package.json", () => {
    const testDir = join("/virtual/test-toolchain-sample");
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
    writeFileSync(join(testDir, "package.json"), JSON.stringify(pkg));

    const policy = discoverToolchainPolicy(testDir);
    expect(policy).toBeDefined();
    expect(policy.commands.typecheck).toBeDefined();
    expect(policy.commands.lint).toBeDefined();
    expect(policy.commands.test).toBeDefined();
  });

  it("handles missing package.json gracefully with safe defaults", () => {
    const testDir = join("/virtual/test-toolchain-empty");
    mkdirSync(testDir, { recursive: true });

    const policy = discoverToolchainPolicy(testDir);
    expect(policy).toBeDefined();
    expect(policy.commands).toBeDefined();
  });
});
