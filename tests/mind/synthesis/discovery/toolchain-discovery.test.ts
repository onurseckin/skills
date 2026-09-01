import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { discoverToolchainPolicy } from "../../../../olt/scripts/src/policy/index.ts";

describe("Autonomous Toolchain Analysis & Policy Calibration (in-memory virtual)", () => {
  const testDir = `${process.cwd()}/.olt/virtual-toolchain-test`;
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    mockFiles.clear();
    mockDirs.clear();
    mockDirs.add(testDir);

    const existsSpy = spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
      const pathStr = String(p);
      return mockFiles.has(pathStr) || mockDirs.has(pathStr);
    });
    spies.push(existsSpy);

    const readSpy = spyOn(fs, "readFileSync").mockImplementation((p: fs.PathOrFileDescriptor) => {
      const pathStr = String(p);
      const val = mockFiles.get(pathStr);
      if (val !== undefined) return val;
      throw new Error(`ENOENT: no such file or directory, open '${pathStr}'`);
    });
    spies.push(readSpy);

    const mkdirSpy = spyOn(fs, "mkdirSync").mockImplementation((p: fs.PathLike) => {
      mockDirs.add(String(p));
      return undefined as unknown as string;
    });
    spies.push(mkdirSpy);
  });

  afterEach(() => {
    while (spies.length > 0) {
      spies.pop()?.mockRestore();
    }
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
    mockFiles.set(join(testDir, "package.json"), JSON.stringify(pkg));

    const policy = discoverToolchainPolicy(testDir);
    expect(policy).toBeDefined();
    expect(policy.commands.typecheck).toBeDefined();
    expect(policy.commands.lint).toBeDefined();
    expect(policy.commands.test).toBeDefined();
  });

  it("handles missing package.json gracefully with safe defaults", () => {
    const emptyDir = `${testDir}/empty`;
    mockDirs.add(emptyDir);

    const policy = discoverToolchainPolicy(emptyDir);
    expect(policy).toBeDefined();
    expect(policy.commands).toBeDefined();
  });
});
