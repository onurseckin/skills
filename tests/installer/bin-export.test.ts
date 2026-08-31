import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildOltBinaryContent, ensureGlobalOltBinary } from "../../scripts/sync/olt-bin";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
  tempRoots.length = 0;
});

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

describe("olt-bin installer", () => {
  test("buildOltBinaryContent produces valid bash wrapper script", () => {
    const harness = "/path/to/harness.ts";
    const script = buildOltBinaryContent(harness);

    expect(script).toContain("#!/usr/bin/env bash");
    expect(script).toContain(`GLOBAL_HARNESS="${harness}"`);
    expect(script).toContain('exec "${BUN_BIN}" "${GLOBAL_HARNESS}" "$@"');
  });

  test("ensureGlobalOltBinary creates binary with 0o755 permissions", () => {
    const mockHome = createTempDir("home-");
    const targetBinDir = join(mockHome, ".local", "bin");

    const result = ensureGlobalOltBinary({
      homeDir: mockHome,
      targetBinDir,
    });

    expect(result.status).toBe("created");
    expect(result.binaryPath).toBe(join(targetBinDir, "olt"));
    expect(existsSync(result.binaryPath)).toBe(true);

    const stats = statSync(result.binaryPath);
    // Verify executable permissions
    expect((stats.mode & 0o111) !== 0).toBe(true);

    const content = readFileSync(result.binaryPath, "utf-8");
    expect(content).toContain('GLOBAL_HARNESS="${HOME}/.agents/skills/olt/scripts/harness.ts"');
  });

  test("returns verified on idempotent subsequent execution", () => {
    const mockHome = createTempDir("home-");
    const targetBinDir = join(mockHome, ".local", "bin");

    const firstResult = ensureGlobalOltBinary({
      homeDir: mockHome,
      targetBinDir,
    });
    expect(firstResult.status).toBe("created");

    const secondResult = ensureGlobalOltBinary({
      homeDir: mockHome,
      targetBinDir,
    });
    expect(secondResult.status).toBe("verified");
  });

  test("updates binary if content or permissions changed", () => {
    const mockHome = createTempDir("home-");
    const targetBinDir = join(mockHome, ".local", "bin");
    const binPath = join(targetBinDir, "olt");

    ensureGlobalOltBinary({
      homeDir: mockHome,
      targetBinDir,
    });

    // Tamper with content
    writeFileSync(binPath, "#!/bin/sh\necho tampered\n", "utf-8");

    const updatedResult = ensureGlobalOltBinary({
      homeDir: mockHome,
      targetBinDir,
    });

    expect(updatedResult.status).toBe("updated");
    const restoredContent = readFileSync(binPath, "utf-8");
    expect(restoredContent).toContain("GLOBAL_HARNESS=");

    // Tamper with permissions (remove execute)
    chmodSync(binPath, 0o644);
    const chmodResult = ensureGlobalOltBinary({
      homeDir: mockHome,
      targetBinDir,
    });
    expect(chmodResult.status).toBe("updated");
    const restoredStats = statSync(binPath);
    expect((restoredStats.mode & 0o111) !== 0).toBe(true);
  });

  test("symlinks into ~/.bun/bin if directory exists", () => {
    const mockHome = createTempDir("home-");
    const targetBinDir = join(mockHome, ".local", "bin");
    const bunBinDir = join(mockHome, ".bun", "bin");
    mkdirSync(bunBinDir, { recursive: true });

    const result = ensureGlobalOltBinary({
      homeDir: mockHome,
      targetBinDir,
    });

    expect(result.bunBinaryCreated).toBe(true);
    const bunOlt = join(bunBinDir, "olt");
    expect(existsSync(bunOlt)).toBe(true);
  });

  test("uses custom harness path when provided", () => {
    const mockHome = createTempDir("home-");
    const targetBinDir = join(mockHome, ".local", "bin");
    const customHarness = "/custom/path/to/harness.ts";

    const result = ensureGlobalOltBinary({
      homeDir: mockHome,
      targetBinDir,
      harnessPath: customHarness,
    });

    expect(result.status).toBe("created");
    const content = readFileSync(result.binaryPath, "utf-8");
    expect(content).toContain(`GLOBAL_HARNESS="${customHarness}"`);
  });
});
