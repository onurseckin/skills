import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_RESOLVED_CONFIG,
  getHarnessConfig,
  resetHarnessConfigCache,
  resolveHarnessConfig,
} from "../../../olt/scripts/src/core/config/index.ts";

const writeFileSync = (p: fs.PathOrFileDescriptor, d: string | NodeJS.ArrayBufferView) =>
  fs.writeFileSync(p, d);

describe("resolved harness config", () => {
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();
  const spies: { mockRestore: () => void }[] = [];
  let dirCounter = 0;

  function makeTempDir(label: string): string {
    const dir = `/virtual/cfg-resolved-${++dirCounter}-${label}`;
    mockDirs.add(dir);
    return dir;
  }

  const origExists = fs.existsSync.bind(fs);
  const origRead = fs.readFileSync.bind(fs);
  const isVirt = (s: string) => s.startsWith("/virtual/") || s.startsWith("/tmp/");

  beforeEach(() => {
    resetHarnessConfigCache();
    mockFiles.clear();
    mockDirs.clear();
    spies.push(
      spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) =>
        isVirt(String(p)) ? mockFiles.has(String(p)) || mockDirs.has(String(p)) : origExists(p),
      ),
      spyOn(fs, "mkdirSync").mockImplementation(((p: fs.PathLike) => {
        mockDirs.add(String(p));
        return undefined as unknown as string;
      }) as unknown as typeof fs.mkdirSync),
      spyOn(fs, "readFileSync").mockImplementation(((p: fs.PathOrFileDescriptor) => {
        if (isVirt(String(p))) {
          const val = mockFiles.get(String(p));
          if (val !== undefined) return val;
          throw new Error(`ENOENT: ${String(p)}`);
        }
        return origRead(p as never);
      }) as unknown as typeof fs.readFileSync),
      spyOn(fs, "writeFileSync").mockImplementation(((
        p: fs.PathOrFileDescriptor,
        d: string | NodeJS.ArrayBufferView,
      ) => {
        mockFiles.set(
          String(p),
          typeof d === "string"
            ? d
            : Buffer.from(d.buffer, d.byteOffset, d.byteLength).toString("utf8"),
        );
      }) as unknown as typeof fs.writeFileSync),
    );
  });

  afterEach(() => {
    resetHarnessConfigCache();
    while (spies.length > 0) spies.pop()?.mockRestore();
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
