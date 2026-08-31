import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readMakefile,
  readPackageJson,
  readPythonManifests,
  readTurboJson,
} from "../../../olt/scripts/src/policy/generator/manifest-readers.ts";

describe("manifest-readers", () => {
  it("handles nonexistent files gracefully", () => {
    const emptyDir = join(tmpdir(), `test-empty-manifest-${Date.now()}`);
    mkdirSync(emptyDir, { recursive: true });
    try {
      const pkg = readPackageJson(emptyDir);
      expect(pkg.exists).toBe(false);
      expect(pkg.hasDep("react")).toBe(false);
      expect(pkg.hasScript("build")).toBe(false);

      const turbo = readTurboJson(emptyDir);
      expect(turbo.exists).toBe(false);
      expect(turbo.hasTask("test")).toBe(false);

      const py = readPythonManifests(emptyDir);
      expect(py.hasPyproject).toBe(false);
      expect(py.usesPytest).toBe(false);
      expect(py.usesRuff).toBe(false);
      expect(py.usesMypy).toBe(false);
      expect(py.usesPoetry).toBe(false);
      expect(py.usesPipenv).toBe(false);

      const make = readMakefile(emptyDir);
      expect(make.exists).toBe(false);
      expect(make.hasTarget("build")).toBe(false);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("handles non-object JSON and corrupted files in safeReadJson", () => {
    const testDir = join(tmpdir(), `test-corrupt-manifest-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    try {
      writeFileSync(join(testDir, "package.json"), "12345");
      const pkg1 = readPackageJson(testDir);
      expect(pkg1.exists).toBe(false);

      writeFileSync(join(testDir, "package.json"), '["array", "not", "object"]');
      const pkg2 = readPackageJson(testDir);
      expect(pkg2.exists).toBe(false);

      writeFileSync(join(testDir, "package.json"), "{ invalid json ");
      const pkg3 = readPackageJson(testDir);
      expect(pkg3.exists).toBe(false);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("reads turbo.json with tasks format and pipeline format", () => {
    const testDir = join(tmpdir(), `test-turbo-tasks-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    try {
      writeFileSync(
        join(testDir, "turbo.json"),
        JSON.stringify({ tasks: { build: {}, test: {} } }),
      );
      const turboTasks = readTurboJson(testDir);
      expect(turboTasks.exists).toBe(true);
      expect(turboTasks.hasTask("build")).toBe(true);
      expect(turboTasks.hasTask("nonexistent")).toBe(false);

      writeFileSync(join(testDir, "turbo.json"), JSON.stringify({ pipeline: { lint: {} } }));
      const turboPipe = readTurboJson(testDir);
      expect(turboPipe.exists).toBe(true);
      expect(turboPipe.hasTask("lint")).toBe(true);

      writeFileSync(join(testDir, "turbo.json"), JSON.stringify({}));
      const turboEmpty = readTurboJson(testDir);
      expect(turboEmpty.exists).toBe(true);
      expect(turboEmpty.hasTask("build")).toBe(false);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("reads Makefile targets accurately", () => {
    const testDir = join(tmpdir(), `test-makefile-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    try {
      writeFileSync(
        join(testDir, "Makefile"),
        `
.PHONY: build test clean

build:
\techo building

test:
\tpytest

check: test
`,
      );

      const make = readMakefile(testDir);
      expect(make.exists).toBe(true);
      expect(make.hasTarget("build")).toBe(true);
      expect(make.hasTarget("test")).toBe(true);
      expect(make.hasTarget("check")).toBe(true);
      expect(make.hasTarget("deploy")).toBe(false);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("reads Python manifests pyproject.toml and requirements.txt", () => {
    const testDir = join(tmpdir(), `test-python-manifest-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    try {
      writeFileSync(
        join(testDir, "pyproject.toml"),
        `
[tool.poetry]
name = "my-package"
[tool.pytest.ini_options]
minversion = "6.0"
[tool.ruff]
line-length = 88
[tool.mypy]
strict = true
`,
      );
      writeFileSync(join(testDir, "Pipfile"), "");

      const py = readPythonManifests(testDir);
      expect(py.hasPyproject).toBe(true);
      expect(py.usesPoetry).toBe(true);
      expect(py.usesPipenv).toBe(true);
      expect(py.usesPytest).toBe(true);
      expect(py.usesRuff).toBe(true);
      expect(py.usesMypy).toBe(true);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});
