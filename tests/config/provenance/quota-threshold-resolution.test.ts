import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import * as harnessConfigModule from "../../../olt/scripts/src/core/config/index.ts";
import {
  DEFAULT_RESOLVED_CONFIG,
  resetHarnessConfigCache,
  resolveHarnessConfig,
} from "../../../olt/scripts/src/core/config/index.ts";
import type {
  ExternallyAttestedFact,
  ExternallyAttestedSource,
} from "../../../olt/scripts/src/core/config/provenance.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

const moduleExports = harnessConfigModule as unknown as Record<string, unknown>;

const FLOOR_EXPORT_NAME = "QUOTA_FREEZE_THRESHOLD_FLOOR_PCT";
const ACCESSOR_EXPORT_NAME = "resolveEffectiveQuotaThreshold";

const RESOLVED_FLOOR_PCT = 10;
const DISCRIMINATING_REMAINING_PCT = 8;

interface EffectiveQuotaThresholdShape {
  readonly value: number;
  readonly source: ExternallyAttestedSource;
}

type ThresholdAccessor = (
  fact: ExternallyAttestedFact<number | null>,
) => EffectiveQuotaThresholdShape;

const NO_HOST_CEILING = { hostConcurrency: null } as const;

const VIRTUAL_CONFIG_ROOT = "/virtual/harness/core/config";
const HARNESS_CONFIG_SOURCE = join(VIRTUAL_CONFIG_ROOT, "contracts.ts");
const PROVENANCE_SOURCE = join(VIRTUAL_CONFIG_ROOT, "provenance.ts");

// Snapshot config contract and provenance files for in-memory VFS verification
const CONFIG_FILE_NAMES = [
  "cadence.ts",
  "contracts.ts",
  "defaults.ts",
  "env.ts",
  "host-canon.ts",
  "host-concurrency.ts",
  "index.ts",
  "parser.ts",
  "provenance.ts",
  "validator.ts",
] as const;

// Read once at module evaluation to eliminate recursive disk traversal during test execution
const CONFIG_SOURCE_SNAPSHOT = new Map<string, string>();
for (const name of CONFIG_FILE_NAMES) {
  try {
    const p = join(import.meta.dir, "..", "..", "..", "olt", "scripts", "src", "core", "config", name);
    CONFIG_SOURCE_SNAPSHOT.set(name, Bun.file(p).text() as unknown as string);
  } catch {}
}

describe("quota freeze threshold resolution", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;
  let dirCounter = 0;

  function makeTempDir(label: string): string {
    const dir = `/virtual/cfg-quota-${++dirCounter}-${label}`;
    vfs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function writePolicy(dir: string, contents: string): void {
    vfs.mkdirSync(join(dir, ".olt"), { recursive: true });
    vfs.writeFileSync(join(dir, ".olt", "policy.json"), contents);
  }

  function readAccessor(): ThresholdAccessor {
    return moduleExports[ACCESSOR_EXPORT_NAME] as unknown as ThresholdAccessor;
  }

  function expectAccessorExported(): void {
    expect(typeof moduleExports[ACCESSOR_EXPORT_NAME]).toBe("function");
  }

  function collectTypeScriptFiles(dir: string, found: string[]): string[] {
    for (const entry of vfs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        collectTypeScriptFiles(entryPath, found);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        found.push(entryPath);
      }
    }
    return found;
  }

  async function populateVirtualHarnessSource(): Promise<void> {
    vfs.mkdirSync(VIRTUAL_CONFIG_ROOT, { recursive: true });
    for (const [name, contentPromise] of CONFIG_SOURCE_SNAPSHOT) {
      const content = typeof contentPromise === "string" ? contentPromise : await contentPromise;
      vfs.writeFileSync(join(VIRTUAL_CONFIG_ROOT, name), content);
    }
  }

  beforeEach(async () => {
    resetHarnessConfigCache();
    vfs = new VirtualMemoryFS();
    await populateVirtualHarnessSource();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    resetHarnessConfigCache();
    if (session) {
      session.cleanup();
      session = null;
    }
  });

  test("the operating floor is one named exported constant equal to 10", () => {
    const floor = moduleExports[FLOOR_EXPORT_NAME];
    expect(typeof floor).toBe("number");
    expect(floor).toBe(RESOLVED_FLOOR_PCT);
  });

  test("the floor constant is defined exactly once across the harness source tree", () => {
    expect(CONFIG_SOURCE_SNAPSHOT.size).toBe(CONFIG_FILE_NAMES.length);
    const files = collectTypeScriptFiles(VIRTUAL_CONFIG_ROOT, []);
    expect(files.length).toBe(CONFIG_FILE_NAMES.length);
    const declarationPattern = new RegExp(`const\\s+${FLOOR_EXPORT_NAME}\\s*[:=]`);
    const definitionSites = files.filter((file) =>
      declarationPattern.test(vfs.readFileSync(file, "utf-8")),
    );
    expect(definitionSites).toHaveLength(1);
    expect(definitionSites[0]).toBe(HARNESS_CONFIG_SOURCE);
    expect(vfs.readFileSync(HARNESS_CONFIG_SOURCE, "utf-8")).toMatch(
      /export const QUOTA_FREEZE_THRESHOLD_FLOOR_PCT = 10;/,
    );
  });

  test("the accessor floors an absent fact at 10 while keeping the absent provenance visible", () => {
    const dir = makeTempDir("absent-fact");
    const config = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
    expect(config.quota_freeze_threshold_pct).toEqual({ value: null, source: "absent" });
    expectAccessorExported();
    expect(readAccessor()(config.quota_freeze_threshold_pct)).toEqual({
      value: RESOLVED_FLOOR_PCT,
      source: "absent",
    });
  });

  test("8 percent reads healthy against the superseded 5.0 literal and constrained against the resolved floor", () => {
    const dir = makeTempDir("eight-percent-discriminator");
    const config = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
    expectAccessorExported();
    const effective = readAccessor()(config.quota_freeze_threshold_pct);
    expect(effective.value).toBe(RESOLVED_FLOOR_PCT);
    expect(DISCRIMINATING_REMAINING_PCT < effective.value).toBe(true);
  });

  test(".olt/policy.json supplies the threshold as a config_override attestation", () => {
    const dir = makeTempDir("policy-layer-override");
    writePolicy(dir, JSON.stringify({ quota_freeze_threshold_pct: 22 }));
    const config = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
    expect(config.quota_freeze_threshold_pct).toEqual({ value: 22, source: "config_override" });
    expect(config.config_provenance.quota_freeze_threshold_pct).toBe("config_override");
    expectAccessorExported();
    expect(readAccessor()(config.quota_freeze_threshold_pct)).toEqual({
      value: 22,
      source: "config_override",
    });
  });

  test("harness.config.json outranks .olt/policy.json for the same key", () => {
    const dir = makeTempDir("policy-layer-precedence");
    writePolicy(dir, JSON.stringify({ quota_freeze_threshold_pct: 22 }));
    vfs.writeFileSync(
      join(dir, "harness.config.json"),
      JSON.stringify({ quota_freeze_threshold_pct: 41 }),
    );
    const config = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
    expect(config.quota_freeze_threshold_pct).toEqual({ value: 41, source: "config_override" });
    expect(config.config_provenance.quota_freeze_threshold_pct).toBe("config_override");
  });

  test("an unparseable .olt/policy.json resolves to unreadable rather than a silent default", () => {
    const dir = makeTempDir("policy-layer-unreadable");
    writePolicy(dir, "{ this is not json");
    const config = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
    expect(config.quota_freeze_threshold_pct).toEqual({ value: null, source: "unreadable" });
    expect(config.config_provenance.quota_freeze_threshold_pct).toBe("unreadable");
    expectAccessorExported();
    expect(readAccessor()(config.quota_freeze_threshold_pct)).toEqual({
      value: RESOLVED_FLOOR_PCT,
      source: "unreadable",
    });
  });

  test("the config layer never fabricates an attestation and never widens the fact source vocabulary", () => {
    const dir = makeTempDir("no-fabricated-attestation");
    writePolicy(dir, JSON.stringify({ schema_version: 1, ecosystem: "bun" }));
    const config = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
    expect(config.quota_freeze_threshold_pct).toEqual({ value: null, source: "absent" });
    expect(config.config_provenance.quota_freeze_threshold_pct).toBe("assumed_default");
    expect(vfs.readFileSync(PROVENANCE_SOURCE, "utf-8")).toMatch(
      /export type ExternallyAttestedSource = "config_override" \| "absent" \| "unreadable";/,
    );
    expectAccessorExported();
    expect(readAccessor()(config.quota_freeze_threshold_pct).source).not.toBe("assumed_default");
  });

  test("no literal quota threshold survives in contracts.ts outside the named constant", () => {
    const source = vfs.readFileSync(HARNESS_CONFIG_SOURCE, "utf-8");
    expect(source).not.toContain("5.0");
    const numericQuotaLines = source
      .split("\n")
      .filter((line) => /quota/i.test(line) && /\d/.test(line));
    expect(numericQuotaLines).toHaveLength(1);
    expect(numericQuotaLines[0]).toContain(FLOOR_EXPORT_NAME);
  });

  test("an explicitly configured 0 is honoured verbatim and never clamped up to the floor", () => {
    const dir = makeTempDir("policy-zero-never-clamped");
    writePolicy(dir, JSON.stringify({ quota_freeze_threshold_pct: 0 }));
    const config = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
    expect(config.quota_freeze_threshold_pct).toEqual({ value: 0, source: "config_override" });
    expectAccessorExported();
    expect(readAccessor()(config.quota_freeze_threshold_pct)).toEqual({
      value: 0,
      source: "config_override",
    });
  });

  test("the policy layer supplies only the threshold and leaks no key whose provenance would be misreported", () => {
    const dir = makeTempDir("policy-layer-no-key-leak");
    writePolicy(dir, JSON.stringify({ max_agents: 3, quota_freeze_threshold_pct: 22 }));
    const config = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
    expect(config.max_agents).toBe(DEFAULT_RESOLVED_CONFIG.max_agents);
    const misreported =
      config.max_agents !== DEFAULT_RESOLVED_CONFIG.max_agents &&
      config.config_provenance.max_agents === "assumed_default";
    expect(misreported).toBe(false);
    expect(config.quota_freeze_threshold_pct).toEqual({ value: 22, source: "config_override" });
  });

  test("the accessor takes its fact explicitly instead of defaulting through process.cwd and a permanent cache", () => {
    expectAccessorExported();
    expect(readAccessor().length).toBe(1);
  });
});
