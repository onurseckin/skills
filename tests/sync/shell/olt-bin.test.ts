import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildOltBinaryContent, ensureGlobalOltBinary } from "../../../scripts/sync/olt-bin.ts";
import { cleanupVirtualSyncFS, scratchRoot, setupVirtualSyncFS } from "../sync-fixture.ts";

beforeEach(() => {
  setupVirtualSyncFS();
});

afterEach(() => {
  cleanupVirtualSyncFS();
});

describe("buildOltBinaryContent", () => {
  test("generates expected bash wrapper script with multi-path Bun discovery", () => {
    const content = buildOltBinaryContent("/custom/path/harness.ts");
    expect(content).toContain("#!/usr/bin/env bash");
    expect(content).toContain('GLOBAL_HARNESS="/custom/path/harness.ts"');
    expect(content).toContain("command -v bun");
    expect(content).toContain("${HOME}/.bun/bin/bun");
    expect(content).toContain("/opt/homebrew/bin/bun");
    expect(content).toContain('exec "${BUN_BIN}" "${GLOBAL_HARNESS}" "$@"');
  });
});

describe("ensureGlobalOltBinary", () => {
  test("creates global binary in target directory if it does not exist", () => {
    const root = scratchRoot(import.meta.path, "olt-bin-create");
    const targetBinDir = join(root, "bin");
    const harnessPath = join(root, "harness.ts");

    const result = ensureGlobalOltBinary({
      homeDir: root,
      targetBinDir,
      harnessPath,
    });

    expect(result.status).toBe("created");
    expect(result.binaryPath).toBe(join(targetBinDir, "olt"));
    expect(existsSync(result.binaryPath)).toBe(true);

    const content = readFileSync(result.binaryPath, "utf-8");
    expect(content).toBe(buildOltBinaryContent(harnessPath));
  });

  test("verifies existing binary if content and executable permissions match", () => {
    const root = scratchRoot(import.meta.path, "olt-bin-verify");
    const targetBinDir = join(root, "bin");
    const harnessPath = join(root, "harness.ts");

    // First create
    const firstResult = ensureGlobalOltBinary({
      homeDir: root,
      targetBinDir,
      harnessPath,
    });
    expect(firstResult.status).toBe("created");

    // Second call should verify
    const secondResult = ensureGlobalOltBinary({
      homeDir: root,
      targetBinDir,
      harnessPath,
    });
    expect(secondResult.status).toBe("verified");
    expect(secondResult.binaryPath).toBe(firstResult.binaryPath);
  });

  test("updates existing binary if content differs", () => {
    const root = scratchRoot(import.meta.path, "olt-bin-update-content");
    const targetBinDir = join(root, "bin");
    mkdirSync(targetBinDir, { recursive: true });
    const binaryPath = join(targetBinDir, "olt");

    // Write outdated content
    writeFileSync(binaryPath, "#!/bin/bash\necho old\n", { encoding: "utf-8", mode: 0o755 });

    const result = ensureGlobalOltBinary({
      homeDir: root,
      targetBinDir,
      harnessPath: "/new/harness.ts",
    });

    expect(result.status).toBe("updated");
    expect(readFileSync(binaryPath, "utf-8")).toBe(buildOltBinaryContent("/new/harness.ts"));
  });

  test("updates existing binary if not executable", () => {
    const root = scratchRoot(import.meta.path, "olt-bin-update-chmod");
    const targetBinDir = join(root, "bin");
    mkdirSync(targetBinDir, { recursive: true });
    const binaryPath = join(targetBinDir, "olt");
    const harnessPath = "/custom/harness.ts";

    writeFileSync(binaryPath, buildOltBinaryContent(harnessPath), "utf-8");
    chmodSync(binaryPath, 0o644); // Not executable

    const result = ensureGlobalOltBinary({
      homeDir: root,
      targetBinDir,
      harnessPath,
    });

    expect(result.status).toBe("updated");
  });

  test("updates binary if existing binary cannot be read or throws error", () => {
    const root = scratchRoot(import.meta.path, "olt-bin-catch-read");
    const targetBinDir = join(root, "bin");
    mkdirSync(targetBinDir, { recursive: true });
    const binaryPath = join(targetBinDir, "olt");
    writeFileSync(binaryPath, "old-content", { encoding: "utf-8", mode: 0o000 });
    try {
      chmodSync(binaryPath, 0o000);
    } catch {}

    try {
      const result = ensureGlobalOltBinary({
        homeDir: root,
        targetBinDir,
        harnessPath: "/custom/harness.ts",
      });

      expect(result.status).toBe("updated");
    } finally {
      try {
        chmodSync(binaryPath, 0o755);
      } catch {}
    }
  });

  test("creates symlink in ~/.bun/bin if directory exists", () => {
    const root = scratchRoot(import.meta.path, "olt-bin-bun");
    const bunBinDir = join(root, ".bun", "bin");
    mkdirSync(bunBinDir, { recursive: true });

    const targetBinDir = join(root, "bin");
    const result = ensureGlobalOltBinary({
      homeDir: root,
      targetBinDir,
    });

    expect(result.status).toBe("created");
    expect(result.bunBinaryCreated).toBe(true);

    const bunOlt = join(bunBinDir, "olt");
    expect(existsSync(bunOlt)).toBe(true);
    expect(lstatSync(bunOlt).isSymbolicLink()).toBe(true);
  });

  test("handles existing symlink in ~/.bun/bin gracefully", () => {
    const root = scratchRoot(import.meta.path, "olt-bin-bun-existing");
    const bunBinDir = join(root, ".bun", "bin");
    mkdirSync(bunBinDir, { recursive: true });

    const targetBinDir = join(root, "bin");
    // Run twice
    ensureGlobalOltBinary({ homeDir: root, targetBinDir });
    const result2 = ensureGlobalOltBinary({ homeDir: root, targetBinDir });

    expect(result2.bunBinaryCreated).toBe(false); // skipped on second run
  });

  test("handles existing directory in ~/.bun/bin gracefully via catch block", () => {
    const root = scratchRoot(import.meta.path, "olt-bin-bun-dir-catch");
    const bunBinDir = join(root, ".bun", "bin");
    mkdirSync(join(bunBinDir, "olt"), { recursive: true }); // Real directory makes smartEnsureSymlink throw

    const targetBinDir = join(root, "bin");
    const result = ensureGlobalOltBinary({ homeDir: root, targetBinDir });
    expect(result.bunBinaryCreated).toBe(false);
  });

  test("handles default options without throwing", () => {
    const root = scratchRoot(import.meta.path, "olt-bin-defaults");
    const result = ensureGlobalOltBinary({ homeDir: root });
    expect(result.binaryPath).toBe(join(root, ".local", "bin", "olt"));
    expect(existsSync(result.binaryPath)).toBe(true);
  });
});
