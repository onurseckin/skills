import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectRepositoryStructure } from "../../../olt/scripts/src/mind/tasks/smart/executor/evolution/repo-structure.ts";

function runInNonTestEnvironment<T>(fn: () => T): T {
  const origNodeEnv = process.env["NODE_ENV"];
  const origBunTest = process.env["BUN_TEST"];
  const origTest = process.env["TEST"];
  const origArgv = [...process.argv];
  try {
    process.env["NODE_ENV"] = "production";
    delete process.env["BUN_TEST"];
    delete process.env["TEST"];
    process.argv = ["bun", "run.js"];
    return fn();
  } finally {
    if (origNodeEnv !== undefined) process.env["NODE_ENV"] = origNodeEnv;
    else delete process.env["NODE_ENV"];
    if (origBunTest !== undefined) process.env["BUN_TEST"] = origBunTest;
    else delete process.env["BUN_TEST"];
    if (origTest !== undefined) process.env["TEST"] = origTest;
    else delete process.env["TEST"];
    process.argv = origArgv;
  }
}

describe("Repository Structure Detection Suite (repo-structure.ts)", () => {
  it("detects virtual and test environment mock structure when undefined or virtual path passed", () => {
    const resDefault = detectRepositoryStructure();
    expect(resDefault.apps).toEqual(["apps"]);
    expect(resDefault.hasApps).toBe(true);
    expect(resDefault.hasPlanning).toBe(true);

    const resVirtual = detectRepositoryStructure("/virtual/custom/repo");
    expect(resVirtual.repoRoot).toBe("/virtual/custom/repo");
    expect(resVirtual.hasPackages).toBe(true);

    const resNonExistent = detectRepositoryStructure("/non/existent/test/path");
    expect(resNonExistent.hasTests).toBe(true);

    const resReal = detectRepositoryStructure(process.cwd());
    expect(resReal.repoRoot).toBe(process.cwd());
    expect(resReal.hasSrc).toBe(true);
  });

  it("finds real repository root when root is omitted in non-test runtime environment", () => {
    const result = runInNonTestEnvironment(() => detectRepositoryStructure());
    expect(result.repoRoot).toBeDefined();
    expect(result.hasSrc).toBe(true);
  });

  it("scans standard directory structures in non-test runtime environment", () => {
    const tempDir = join(tmpdir(), `repo-struct-std-${Date.now()}`);
    mkdirSync(join(tempDir, "apps", "web"), { recursive: true });
    mkdirSync(join(tempDir, "packages", "core"), { recursive: true });
    mkdirSync(join(tempDir, "src", "engine"), { recursive: true });
    mkdirSync(join(tempDir, "tests", "unit"), { recursive: true });
    mkdirSync(join(tempDir, "docs", "planning"), { recursive: true });

    try {
      const result = runInNonTestEnvironment(() => detectRepositoryStructure(tempDir));
      expect(result.repoRoot).toBe(tempDir);
      expect(result.hasApps).toBe(true);
      expect(result.apps).toContain("apps");
      expect(result.apps).toContain("apps/web");
      expect(result.hasPackages).toBe(true);
      expect(result.packages).toContain("packages");
      expect(result.packages).toContain("packages/core");
      expect(result.hasSrc).toBe(true);
      expect(result.src).toContain("src");
      expect(result.src).toContain("src/engine");
      expect(result.hasTests).toBe(true);
      expect(result.tests).toContain("tests");
      expect(result.tests).toContain("tests/unit");
      expect(result.hasDocs).toBe(true);
      expect(result.docs).toContain("docs");
      expect(result.docs).toContain("docs/planning");
      expect(result.hasPlanning).toBe(true);
      expect(result.planning).toEqual(["docs/planning"]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("scans alternative naming directory conventions (app, pkg, lib, test, documentation, planning)", () => {
    const tempDir = join(tmpdir(), `repo-struct-alt1-${Date.now()}`);
    mkdirSync(join(tempDir, "app", "mobile"), { recursive: true });
    mkdirSync(join(tempDir, "pkg", "utils"), { recursive: true });
    mkdirSync(join(tempDir, "lib", "helpers"), { recursive: true });
    mkdirSync(join(tempDir, "test", "e2e"), { recursive: true });
    mkdirSync(join(tempDir, "documentation"), { recursive: true });
    mkdirSync(join(tempDir, "planning"), { recursive: true });

    try {
      const result = runInNonTestEnvironment(() => detectRepositoryStructure(tempDir));
      expect(result.hasApps).toBe(true);
      expect(result.apps).toContain("app");
      expect(result.apps).toContain("app/mobile");
      expect(result.hasPackages).toBe(true);
      expect(result.packages).toContain("pkg");
      expect(result.packages).toContain("pkg/utils");
      expect(result.hasSrc).toBe(true);
      expect(result.src).toContain("lib");
      expect(result.src).toContain("lib/helpers");
      expect(result.hasTests).toBe(true);
      expect(result.tests).toContain("test");
      expect(result.tests).toContain("test/e2e");
      expect(result.hasDocs).toBe(true);
      expect(result.docs).toEqual(["documentation"]);
      expect(result.hasPlanning).toBe(true);
      expect(result.planning).toEqual(["planning"]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("scans secondary alternative naming conventions (modules, olt/scripts/src, spec)", () => {
    const tempDir = join(tmpdir(), `repo-struct-alt2-${Date.now()}`);
    mkdirSync(join(tempDir, "modules", "auth"), { recursive: true });
    mkdirSync(join(tempDir, "olt", "scripts", "src"), { recursive: true });
    mkdirSync(join(tempDir, "spec", "features"), { recursive: true });

    try {
      const result = runInNonTestEnvironment(() => detectRepositoryStructure(tempDir));
      expect(result.hasApps).toBe(false);
      expect(result.apps).toEqual([]);
      expect(result.hasPackages).toBe(true);
      expect(result.packages).toContain("modules");
      expect(result.packages).toContain("modules/auth");
      expect(result.hasSrc).toBe(true);
      expect(result.src).toEqual(["olt/scripts/src"]);
      expect(result.hasTests).toBe(true);
      expect(result.tests).toContain("spec");
      expect(result.tests).toContain("spec/features");
      expect(result.hasDocs).toBe(false);
      expect(result.hasPlanning).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("handles completely empty repository directory cleanly in non-test runtime", () => {
    const tempDir = join(tmpdir(), `repo-struct-empty-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    try {
      const result = runInNonTestEnvironment(() => detectRepositoryStructure(tempDir));
      expect(result.hasApps).toBe(false);
      expect(result.hasPackages).toBe(false);
      expect(result.hasSrc).toBe(false);
      expect(result.hasTests).toBe(false);
      expect(result.hasDocs).toBe(false);
      expect(result.hasPlanning).toBe(false);
      expect(result.apps).toEqual([]);
      expect(result.packages).toEqual([]);
      expect(result.src).toEqual([]);
      expect(result.tests).toEqual([]);
      expect(result.docs).toEqual([]);
      expect(result.planning).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
