import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_CONFIG,
  DEFAULT_RESOLVED_CONFIG,
  getHarnessConfig,
  loadHarnessConfig,
  resetHarnessConfigCache,
  resolveHarnessConfig,
} from "../../../orchestrating-long-tasks/scripts/src/config/harness-config.ts";

describe("resolved harness config", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "resolved-config-test-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // cleanup ignore
      }
    }
    tempDirs.length = 0;
    resetHarnessConfigCache();
  });

  test("defaults to one adversarial probe and six repair rounds", () => {
    const config = resolveHarnessConfig(makeTempDir());
    expect(config).toEqual(DEFAULT_RESOLVED_CONFIG);
    expect(config.min_adversarial_probes).toBe(1);
    expect(config.max_repair_rounds).toBe(6);
    expect(config.default_max_parallel).toBe(4);
  });

  test("reads the probe key, and never lets the legacy rejection key set the probe count", () => {
    const probeDir = makeTempDir();
    writeFileSync(
      join(probeDir, "harness.config.json"),
      JSON.stringify({ min_adversarial_probes: 3 }),
    );
    const probeConfig = resolveHarnessConfig(probeDir);
    expect(probeConfig.min_adversarial_probes).toBe(3);
    expect(probeConfig.min_adversarial_rejections).toBe(3);

    const legacyDir = makeTempDir();
    writeFileSync(
      join(legacyDir, "harness.config.json"),
      JSON.stringify({ min_adversarial_rejections: 2 }),
    );
    const legacyConfig = resolveHarnessConfig(legacyDir);
    expect(legacyConfig.min_adversarial_probes).toBe(1);
    expect(legacyConfig.min_adversarial_rejections).toBe(2);
  });

  test("prefers the probe key when a file carries both spellings", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "harness.config.json"),
      JSON.stringify({ min_adversarial_probes: 5, min_adversarial_rejections: 9 }),
    );
    const config = resolveHarnessConfig(dir);
    expect(config.min_adversarial_probes).toBe(5);
    expect(config.min_adversarial_rejections).toBe(9);
  });

  test("rejects non-integer and negative probe counts", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "harness.config.json"),
      JSON.stringify({ min_adversarial_probes: -1, max_repair_rounds: 1.5 }),
    );
    expect(resolveHarnessConfig(dir)).toEqual(DEFAULT_RESOLVED_CONFIG);
  });

  test("lets a repo layer override a capsule layer", () => {
    const repoDir = makeTempDir();
    const capDir = makeTempDir();
    writeFileSync(
      join(capDir, "config.json"),
      JSON.stringify({ min_adversarial_probes: 4, default_max_parallel: 8 }),
    );
    writeFileSync(
      join(repoDir, "harness.config.json"),
      JSON.stringify({ min_adversarial_probes: 2 }),
    );

    const config = resolveHarnessConfig(repoDir, capDir);
    expect(config.min_adversarial_probes).toBe(2);
    expect(config.default_max_parallel).toBe(8);
  });

  test("keeps loadHarnessConfig on the legacy key set", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "harness.config.json"), JSON.stringify({ min_adversarial_probes: 3 }));
    const config = loadHarnessConfig(dir);
    expect(Object.keys(config).sort()).toEqual(Object.keys(DEFAULT_CONFIG).sort());
    expect(config.min_adversarial_rejections).toBe(3);
  });

  test("caches per root pair and rereads after a reset", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "harness.config.json"), JSON.stringify({ min_adversarial_probes: 2 }));
    const first = getHarnessConfig(dir);
    expect(first.min_adversarial_probes).toBe(2);
    expect(getHarnessConfig(dir)).toBe(first);

    writeFileSync(join(dir, "harness.config.json"), JSON.stringify({ min_adversarial_probes: 7 }));
    expect(getHarnessConfig(dir).min_adversarial_probes).toBe(2);

    resetHarnessConfigCache();
    expect(getHarnessConfig(dir).min_adversarial_probes).toBe(7);
  });

  test("hands out a frozen instance callers cannot mutate", () => {
    const config = getHarnessConfig(makeTempDir());
    expect(Object.isFrozen(config)).toBeTrue();
  });
});
