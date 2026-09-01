import { describe, expect, it, beforeEach } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import {
  quotaProvenanceSource,
  resolveQuotaFreezeThresholdFact,
  resolveConcurrencyCeiling,
  resolveHarnessConfig,
  cacheKey,
  getHarnessConfig,
  resetHarnessConfigCache,
} from "../../../olt/scripts/src/core/config/env.ts";
import {
  canonicalizeHostId,
  resolveHostProviderLoose,
  canonicalHostFromOutcome,
  isTimerArmingMechanism,
  parseHostProfiles,
  CANONICAL_HOSTS,
  KNOWN_UNRESOLVABLE_HOST_IDS,
  TIMER_ARMING_MECHANISMS,
} from "../../../olt/scripts/src/core/config/host-canon.ts";
import {
  discoverHostConcurrencyCeiling,
  deriveGateConcurrencyCeiling,
} from "../../../olt/scripts/src/core/config/host-concurrency.ts";
import {
  parseConfigFile,
  parsePolicyLayer,
  inspectHarnessConfigFile,
  HARNESS_CONFIG_KEYS,
} from "../../../olt/scripts/src/core/config/parser.ts";
import {
  isConfigValueSource,
  unattestedFact,
  unreadableFact,
  attestedFact,
  buildConfigProvenanceMap,
  CONFIG_VALUE_SOURCES,
  TRACKED_CONFIG_KEYS,
} from "../../../olt/scripts/src/core/config/provenance.ts";
import {
  resolveEffectiveQuotaThreshold,
  positiveCount,
  booleanField,
  textField,
  percentField,
  modelByRoleField,
  fleetAgentCeilingField,
  safeCause,
  invalidConfig,
  hasOwn,
} from "../../../olt/scripts/src/core/config/validator.ts";
import {
  DEFAULT_CONFIG,
  DEFAULT_RESOLVED_CONFIG,
  DEFAULT_PROVENANCE_MAP,
} from "../../../olt/scripts/src/core/config/defaults.ts";
import {
  QUOTA_FREEZE_THRESHOLD_FLOOR_PCT,
  MANIFEST_SCHEMA,
  STATE_SCHEMA,
  EVENT_SCHEMA,
  FORMAT_VERSION,
  RUNTIME_VERSION,
  MINIMUM_BUN_VERSION,
  MAX_JSON_FILE_BYTES,
  MIN_ADVERSARIAL_PROBES,
  MAX_REPAIR_ROUNDS,
} from "../../../olt/scripts/src/core/config/contracts.ts";
import {
  isCadenceWakeKind,
  classifyCadenceWake,
  isCadenceWakeReferenceFrame,
  classifyCadenceWakeInstant,
  resolveSupervisoryCadence,
  CADENCE_WAKE_KINDS,
  CADENCE_WAKE_REFERENCE_FRAMES,
} from "../../../olt/scripts/src/core/config/cadence.ts";
import * as CoreConfigIndex from "../../../olt/scripts/src/core/config/index.ts";

describe("core/config/validator.ts", () => {
  it("resolveEffectiveQuotaThreshold handles config_override vs default fallback", () => {
    expect(resolveEffectiveQuotaThreshold(attestedFact(85))).toEqual({
      value: 85,
      source: "config_override",
    });
    expect(resolveEffectiveQuotaThreshold(attestedFact(null))).toEqual({
      value: QUOTA_FREEZE_THRESHOLD_FLOOR_PCT,
      source: "config_override",
    });
    expect(resolveEffectiveQuotaThreshold(unattestedFact(null))).toEqual({
      value: QUOTA_FREEZE_THRESHOLD_FLOOR_PCT,
      source: "absent",
    });
    expect(resolveEffectiveQuotaThreshold(unreadableFact(null))).toEqual({
      value: QUOTA_FREEZE_THRESHOLD_FLOOR_PCT,
      source: "unreadable",
    });
  });

  it("positiveCount validates safe integers >= minimum", () => {
    expect(positiveCount(5, 1)).toBe(5);
    expect(positiveCount(0, 0)).toBe(0);
    expect(positiveCount(0, 1)).toBeNull();
    expect(positiveCount(-1, 0)).toBeNull();
    expect(positiveCount(1.5, 1)).toBeNull();
    expect(positiveCount("5", 1)).toBeNull();
    expect(positiveCount(null, 1)).toBeNull();
    expect(positiveCount(undefined, 1)).toBeNull();
  });

  it("booleanField validates booleans", () => {
    expect(booleanField(true)).toBe(true);
    expect(booleanField(false)).toBe(false);
    expect(booleanField("true")).toBeNull();
    expect(booleanField(1)).toBeNull();
    expect(booleanField(null)).toBeNull();
  });

  it("textField validates non-empty trimmed strings", () => {
    expect(textField("hello")).toBe("hello");
    expect(textField("  ")).toBeNull();
    expect(textField("")).toBeNull();
    expect(textField(123)).toBeNull();
    expect(textField(null)).toBeNull();
  });

  it("percentField validates 0..100 percentages", () => {
    expect(percentField(0)).toBe(0);
    expect(percentField(50.5)).toBe(50.5);
    expect(percentField(100)).toBe(100);
    expect(percentField(-1)).toBeNull();
    expect(percentField(101)).toBeNull();
    expect(percentField(NaN)).toBeNull();
    expect(percentField(Infinity)).toBeNull();
    expect(percentField("50")).toBeNull();
  });

  it("modelByRoleField validates role mappings", () => {
    expect(modelByRoleField({ coordinator: "gpt-4o", implementer: "claude-3-5-sonnet" })).toEqual({
      coordinator: "gpt-4o",
      implementer: "claude-3-5-sonnet",
    });
    expect(modelByRoleField(null)).toBeNull();
    expect(modelByRoleField("invalid")).toBeNull();
    expect(modelByRoleField([])).toBeNull();
    expect(modelByRoleField({ invalid_role: "model" })).toBeNull();
    expect(modelByRoleField({ coordinator: "" })).toBeNull();
    expect(modelByRoleField({ coordinator: 123 })).toBeNull();
  });

  it("fleetAgentCeilingField validates positive counts as attested facts", () => {
    expect(fleetAgentCeilingField(10)).toEqual(attestedFact(10));
    expect(fleetAgentCeilingField(0)).toBeNull();
    expect(fleetAgentCeilingField(-5)).toBeNull();
    expect(fleetAgentCeilingField("10")).toBeNull();
  });

  it("safeCause extracts clean string representation from unknown error shapes", () => {
    expect(safeCause("simple string error")).toBe("simple string error");
    expect(safeCause(404)).toBe("404");
    expect(safeCause(true)).toBe("true");
    expect(safeCause(BigInt(123))).toBe("123");
    expect(safeCause(Symbol("test"))).toBe("Symbol(test)");
    expect(safeCause(null)).toBe("null");
    expect(safeCause(undefined)).toBe("undefined");
    expect(safeCause(new Error("error message"))).toBe("error message");
    const objWithMessage = { message: "custom obj message" };
    expect(safeCause(objWithMessage)).toBe("custom obj message");
    const throwingObj = Object.create(null);
    Object.defineProperty(throwingObj, "message", {
      get() {
        throw new Error("fail");
      },
    });
    expect(safeCause(throwingObj)).toBe("unknown error");
  });

  it("invalidConfig throws HarnessError INTEGRITY", () => {
    expect(() => invalidConfig("file.json", "key1", "is bad")).toThrow(HarnessError);
    try {
      invalidConfig("file.json", "key1", "is bad");
    } catch (e) {
      const err = e as HarnessError;
      expect(err.code).toBe("INTEGRITY");
      expect(err.message).toContain("file.json config key 'key1' is bad");
    }
  });

  it("hasOwn checks object properties safely", () => {
    expect(hasOwn({ a: 1 }, "a")).toBe(true);
    expect(hasOwn({ a: 1 }, "b")).toBe(false);
  });
});

describe("core/config/provenance.ts", () => {
  it("isConfigValueSource validates known sources", () => {
    for (const src of CONFIG_VALUE_SOURCES) {
      expect(isConfigValueSource(src)).toBe(true);
    }
    expect(isConfigValueSource("random")).toBe(false);
    expect(isConfigValueSource(123)).toBe(false);
    expect(isConfigValueSource(null)).toBe(false);
  });

  it("attestation helpers create correct envelopes", () => {
    expect(unattestedFact(10)).toEqual({ value: 10, source: "absent" });
    expect(unreadableFact("fallback")).toEqual({ value: "fallback", source: "unreadable" });
    expect(attestedFact(true)).toEqual({ value: true, source: "config_override" });
  });

  it("buildConfigProvenanceMap accurately attributes sources", () => {
    const hostDiscovered = new Set<any>(["gate_max_parallel"]);
    const map = buildConfigProvenanceMap(
      { max_repair_rounds: 3 },
      { max_agents: 5 },
      hostDiscovered,
      { default_max_parallel: "config_override" },
    );
    expect(map.max_repair_rounds).toBe("config_override");
    expect(map.max_agents).toBe("config_override");
    expect(map.gate_max_parallel).toBe("host_discovered");
    expect(map.default_max_parallel).toBe("config_override");
    expect(map.max_branch_depth).toBe("assumed_default");
  });
});
