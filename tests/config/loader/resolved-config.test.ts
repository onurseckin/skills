import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_RESOLVED_CONFIG,
  getHarnessConfig,
  resetHarnessConfigCache,
  resolveHarnessConfig,
} from "../../../olt/scripts/src/core/config/index.ts";

describe("resolved harness config", () => {
  const roots: string[] = [];

  function makeTempDir(label: string): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), `cfg-resolved-${label}-`)));
    roots.push(dir);
    return dir;
  }

  afterEach(() => {
    resetHarnessConfigCache();
    for (const root of roots.splice(0)) {
      if (existsSync(root)) {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  test("defaults to one adversarial probe and six repair rounds", () => {
    const config = resolveHarnessConfig(makeTempDir("defaults"), undefined, {
      hostConcurrency: null,
    });
    expect(config).toEqual(DEFAULT_RESOLVED_CONFIG);
    expect(config.min_adversarial_probes).toBe(DEFAULT_RESOLVED_CONFIG.min_adversarial_probes);
    expect(config.max_repair_rounds).toBe(DEFAULT_RESOLVED_CONFIG.max_repair_rounds);
    expect(config.default_max_parallel).toBe(4);
  });

  test("reads the probe key from a config file", () => {
    const probeDir = makeTempDir("probe-key");
    writeFileSync(
      join(probeDir, "harness.config.json"),
      JSON.stringify({ min_adversarial_probes: 3 }),
    );
    const probeConfig = resolveHarnessConfig(probeDir);
    expect(probeConfig.min_adversarial_probes).toBe(3);
  });

  test("rejects non-integer and negative probe counts", () => {
    const dir = makeTempDir("invalid-probe-count");
    writeFileSync(
      join(dir, "harness.config.json"),
      JSON.stringify({ min_adversarial_probes: -1, max_repair_rounds: 1.5 }),
    );
    expect(() => resolveHarnessConfig(dir, undefined, { hostConcurrency: null })).toThrow(
      /min_adversarial_probes/,
    );
  });

  test("lets a repo layer override a capsule layer", () => {
    const repoDir = makeTempDir("repo-layer");
    const capDir = makeTempDir("capsule-layer");
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

  test("caches per root pair and rereads after a reset", () => {
    const dir = makeTempDir("cache-reset");
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
    const config = getHarnessConfig(makeTempDir("frozen-instance"));
    expect(Object.isFrozen(config)).toBeTrue();
  });
});
