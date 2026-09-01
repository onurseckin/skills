import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  DEFAULT_RESOLVED_CONFIG,
  getHarnessConfig,
  resetHarnessConfigCache,
  resolveHarnessConfig,
} from "../../../olt/scripts/src/core/config/index.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("resolved harness config", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;
  let dirCounter = 0;

  function makeTempDir(label: string): string {
    const dir = `/virtual/cfg-resolved-${++dirCounter}-${label}`;
    vfs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  beforeEach(() => {
    resetHarnessConfigCache();
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    resetHarnessConfigCache();
    if (session) {
      session.cleanup();
      session = null;
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
    vfs.writeFileSync(
      join(probeDir, "harness.config.json"),
      JSON.stringify({ min_adversarial_probes: 3 }),
    );
    const probeConfig = resolveHarnessConfig(probeDir);
    expect(probeConfig.min_adversarial_probes).toBe(3);
  });

  test("rejects non-integer and negative probe counts", () => {
    const dir = makeTempDir("invalid-probe-count");
    vfs.writeFileSync(
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
    vfs.writeFileSync(
      join(capDir, "config.json"),
      JSON.stringify({ min_adversarial_probes: 4, default_max_parallel: 8 }),
    );
    vfs.writeFileSync(
      join(repoDir, "harness.config.json"),
      JSON.stringify({ min_adversarial_probes: 2 }),
    );

    const config = resolveHarnessConfig(repoDir, capDir);
    expect(config.min_adversarial_probes).toBe(2);
    expect(config.default_max_parallel).toBe(8);
  });

  test("caches per root pair and rereads after a reset", () => {
    const dir = makeTempDir("cache-reset");
    vfs.writeFileSync(
      join(dir, "harness.config.json"),
      JSON.stringify({ min_adversarial_probes: 2 }),
    );
    const first = getHarnessConfig(dir);
    expect(first.min_adversarial_probes).toBe(2);
    expect(getHarnessConfig(dir)).toBe(first);

    vfs.writeFileSync(
      join(dir, "harness.config.json"),
      JSON.stringify({ min_adversarial_probes: 7 }),
    );
    expect(getHarnessConfig(dir).min_adversarial_probes).toBe(2);

    resetHarnessConfigCache();
    expect(getHarnessConfig(dir).min_adversarial_probes).toBe(7);
  });

  test("hands out a frozen instance callers cannot mutate", () => {
    const config = getHarnessConfig(makeTempDir("frozen-instance"));
    expect(Object.isFrozen(config)).toBeTrue();
  });
});
