import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_RESOLVED_CONFIG,
  getHarnessConfig,
  resetHarnessConfigCache,
  resolveHarnessConfig,
} from "../../../olt/scripts/src/core/config/harness-config.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("resolved harness config", () => {
  // scratchRoot() creates and tears down each directory itself (see tests/support/README.md) —
  // this file only still needs its own afterEach for the config-cache reset, an orthogonal
  // per-test isolation concern scratchRoot doesn't own.
  function makeTempDir(label: string): string {
    return scratchRoot(import.meta.path, label);
  }

  afterEach(() => {
    resetHarnessConfigCache();
  });

  test("defaults to one adversarial probe and six repair rounds", () => {
    // B27.2: host discovery reads the live environment, so pin it absent here — this test is about
    // the probe/repair-round defaults, not about what this suite's own host happens to publish.
    // See host-concurrency.test.ts and harness-config.test.ts's "B27.2" block for that behaviour.
    const config = resolveHarnessConfig(makeTempDir("defaults"), undefined, {
      hostConcurrency: null,
    });
    expect(config).toEqual(DEFAULT_RESOLVED_CONFIG);
    expect(config.min_adversarial_probes).toBe(1);
    expect(config.max_repair_rounds).toBe(6);
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
    expect(resolveHarnessConfig(dir, undefined, { hostConcurrency: null })).toEqual(
      DEFAULT_RESOLVED_CONFIG,
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
