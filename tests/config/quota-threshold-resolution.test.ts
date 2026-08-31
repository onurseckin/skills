import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as harnessConfigModule from "../../olt/scripts/src/core/config/index.ts";
import {
  DEFAULT_RESOLVED_CONFIG,
  resolveHarnessConfig,
} from "../../olt/scripts/src/core/config/index.ts";
import type {
  ExternallyAttestedFact,
  ExternallyAttestedSource,
} from "../../olt/scripts/src/core/config/provenance.ts";
import { scratchRoot } from "../shared/scratch-root.ts";

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

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const HARNESS_SOURCE_ROOT = join(REPO_ROOT, "olt", "scripts", "src");
const HARNESS_CONFIG_SOURCE = join(HARNESS_SOURCE_ROOT, "core", "config", "contracts.ts");
const PROVENANCE_SOURCE = join(HARNESS_SOURCE_ROOT, "core", "config", "provenance.ts");

function makeTempDir(label: string): string {
  return scratchRoot(import.meta.path, label);
}

function writePolicy(dir: string, contents: string): void {
  mkdirSync(join(dir, ".olt"), { recursive: true });
  writeFileSync(join(dir, ".olt", "policy.json"), contents);
}

function readAccessor(): ThresholdAccessor {
  return moduleExports[ACCESSOR_EXPORT_NAME] as unknown as ThresholdAccessor;
}

function expectAccessorExported(): void {
  expect(typeof moduleExports[ACCESSOR_EXPORT_NAME]).toBe("function");
}

function collectTypeScriptFiles(dir: string, found: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      collectTypeScriptFiles(join(dir, entry.name), found);
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

describe("quota freeze threshold resolution", () => {
  test("the operating floor is one named exported constant equal to 10", () => {
    const floor = moduleExports[FLOOR_EXPORT_NAME];
    expect(typeof floor).toBe("number");
    expect(floor).toBe(RESOLVED_FLOOR_PCT);
  });

  test("the floor constant is defined exactly once across the harness source tree", () => {
    const files = collectTypeScriptFiles(HARNESS_SOURCE_ROOT, []);
    expect(files.length).toBeGreaterThan(0);
    const declarationPattern = new RegExp(`const\\s+${FLOOR_EXPORT_NAME}\\s*[:=]`);
    const definitionSites = files.filter((file) =>
      declarationPattern.test(readFileSync(file, "utf-8")),
    );
    expect(definitionSites).toHaveLength(1);
    expect(definitionSites[0]).toBe(HARNESS_CONFIG_SOURCE);
    expect(readFileSync(HARNESS_CONFIG_SOURCE, "utf-8")).toMatch(
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
    writeFileSync(
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
    expect(readFileSync(PROVENANCE_SOURCE, "utf-8")).toMatch(
      /export type ExternallyAttestedSource = "config_override" \| "absent" \| "unreadable";/,
    );
    expectAccessorExported();
    expect(readAccessor()(config.quota_freeze_threshold_pct).source).not.toBe("assumed_default");
  });

  test("no literal quota threshold survives in contracts.ts outside the named constant", () => {
    const source = readFileSync(HARNESS_CONFIG_SOURCE, "utf-8");
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
