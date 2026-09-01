import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { setupVirtualMindFS, cleanupVirtualMindFS, scratchRoot } from "../../fixtures/index.ts";
import { discoverToolchainPolicy } from "../../../../olt/scripts/src/policy/index.ts";

describe("Autonomous Toolchain Analysis & Policy Calibration (in-memory virtual)", () => {
  let testDir: string;

  beforeEach(() => {
    setupVirtualMindFS();
    testDir = scratchRoot("toolchain-discovery", "test");
  });

  afterEach(() => {
    cleanupVirtualMindFS();
  });

  it("discovers bun, oxlint, and tsc toolchains from package.json", () => {
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
    fs.writeFileSync(join(testDir, "package.json"), JSON.stringify(pkg));

    const policy = discoverToolchainPolicy(testDir);
    expect(policy).toBeDefined();
    expect(policy.commands.typecheck).toBeDefined();
    expect(policy.commands.lint).toBeDefined();
    expect(policy.commands.test).toBeDefined();
  });

  it("handles missing package.json gracefully with safe defaults", () => {
    const emptyDir = `${testDir}/empty`;
    fs.mkdirSync(emptyDir, { recursive: true });

    const policy = discoverToolchainPolicy(emptyDir);
    expect(policy).toBeDefined();
    expect(policy.commands).toBeDefined();
  });
});
