import { describe, expect, it, beforeEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

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

describe("core/config/host-canon.ts", () => {
  it("canonicalizeHostId resolves exact providers, aliases, known unresolvable, and unrecognized", () => {
    expect(canonicalizeHostId(undefined)).toEqual({ kind: "absent" });
    expect(canonicalizeHostId("")).toEqual({ kind: "absent" });
    expect(canonicalizeHostId("   ")).toEqual({ kind: "absent" });
    expect(canonicalizeHostId("antigravity")).toEqual({ kind: "resolved", host: "antigravity" });
    expect(canonicalizeHostId("claude")).toEqual({ kind: "resolved", host: "claude-code" });
    expect(canonicalizeHostId("cursor")).toEqual({ kind: "resolved", host: "cursor" });
    expect(canonicalizeHostId("generic")).toEqual({ kind: "known_unresolvable", rawId: "generic" });
    expect(canonicalizeHostId("unknown-host-xyz")).toEqual({ kind: "unrecognized", rawId: "unknown-host-xyz" });
  });

  it("resolveHostProviderLoose recognizes fuzzy host keywords", () => {
    expect(resolveHostProviderLoose("")).toBe("unknown");
    expect(resolveHostProviderLoose(null)).toBe("unknown");
    expect(resolveHostProviderLoose("claude-code")).toBe("claude-code");
    expect(resolveHostProviderLoose("claude")).toBe("claude-code");
    expect(resolveHostProviderLoose("anthropic-v1")).toBe("claude-code");
    expect(resolveHostProviderLoose("cursor-ide")).toBe("cursor");
    expect(resolveHostProviderLoose("codex-cli")).toBe("codex");
    expect(resolveHostProviderLoose("chatgpt-web")).toBe("chatgpt");
    expect(resolveHostProviderLoose("openai-host")).toBe("chatgpt");
    expect(resolveHostProviderLoose("gpt-4o")).toBe("chatgpt");
    expect(resolveHostProviderLoose("gemini-host")).toBe("antigravity");
    expect(resolveHostProviderLoose("antigravity-runner")).toBe("antigravity");
    expect(resolveHostProviderLoose("completely-unknown")).toBe("unknown");
  });

  it("canonicalHostFromOutcome creates appropriate attested facts", () => {
    expect(canonicalHostFromOutcome({ kind: "resolved", host: "cursor" })).toEqual(attestedFact("cursor"));
    expect(canonicalHostFromOutcome({ kind: "absent" })).toEqual(unattestedFact(null));
    expect(canonicalHostFromOutcome({ kind: "unrecognized", rawId: "bad" })).toEqual(unreadableFact(null));
  });

  it("isTimerArmingMechanism validates supported mechanisms", () => {
    for (const m of TIMER_ARMING_MECHANISMS) {
      expect(isTimerArmingMechanism(m)).toBe(true);
    }
    expect(isTimerArmingMechanism("invalid")).toBe(false);
    expect(isTimerArmingMechanism(null)).toBe(false);
  });

  it("parseHostProfiles validates host profile dictionaries", () => {
    expect(parseHostProfiles(null, "config.json")).toEqual({});
    expect(parseHostProfiles("invalid", "config.json")).toEqual({});
    expect(parseHostProfiles([], "config.json")).toEqual({});

    const validProfiles = {
      cursor: {
        timer_arming_mechanism: "systemd",
        wake_driver_present: true,
        self_wake_supported: false,
        models_available: ["gpt-4o", "claude-3-5"],
      },
      "claude-code": {
        timer_arming_mechanism: "invalid_mechanism",
        wake_driver_present: "not_a_bool",
        self_wake_supported: true,
        models_available: "not_an_array",
      },
    };

    const parsed = parseHostProfiles(validProfiles, "test-config.json");
    expect(parsed.cursor?.timer_arming_mechanism).toEqual(attestedFact("systemd"));
    expect(parsed.cursor?.wake_driver_present).toEqual(attestedFact(true));
    expect(parsed.cursor?.self_wake_supported).toEqual(attestedFact(false));
    expect(parsed.cursor?.models_available).toEqual(attestedFact(["gpt-4o", "claude-3-5"]));

    expect(parsed["claude-code"]?.timer_arming_mechanism).toEqual(unreadableFact("none"));
    expect(parsed["claude-code"]?.wake_driver_present).toEqual(unreadableFact(false));
    expect(parsed["claude-code"]?.self_wake_supported).toEqual(attestedFact(true));
    expect(parsed["claude-code"]?.models_available).toEqual(unreadableFact([]));

    expect(() =>
      parseHostProfiles({ "unknown-host": {} }, "invalid.json"),
    ).toThrow(HarnessError);
  });
});

describe("core/config/host-concurrency.ts", () => {
  it("discoverHostConcurrencyCeiling probes telemetry", () => {
    const ceiling = discoverHostConcurrencyCeiling();
    if (ceiling !== null) {
      expect(ceiling.value).toBeGreaterThanOrEqual(1);
      expect(typeof ceiling.hostTool).toBe("string");
    }
  });

  it("deriveGateConcurrencyCeiling computes ceiling safely from cpuCount or fallback probes", () => {
    expect(deriveGateConcurrencyCeiling(8)).toBe(4);
    expect(deriveGateConcurrencyCeiling(1)).toBe(1);
    expect(deriveGateConcurrencyCeiling(0)).toBe(1);

    const customProbes = {
      availableParallelism: () => 16,
      cpuCount: () => 16,
    };
    expect(deriveGateConcurrencyCeiling(undefined, customProbes)).toBe(8);

    const throwingProbes = {
      availableParallelism: () => {
        throw new Error("fail");
      },
      cpuCount: () => {
        throw new Error("fail");
      },
    };
    expect(deriveGateConcurrencyCeiling(undefined, throwingProbes)).toBe(1);
  });
});

describe("core/config/parser.ts", () => {
  it("parseConfigFile returns null when file does not exist", () => {
    expect(parseConfigFile("/path/to/nonexistent/file.json")).toBeNull();
  });

  it("parseConfigFile rejects invalid JSON or non-object root", () => {
    const tmp = makeTmpDir("config-parser-tests-");
    try {
      const badJson = join(tmp, "bad.json");
      writeFileSync(badJson, "{ invalid json");
      expect(() => parseConfigFile(badJson)).toThrow(HarnessError);

      const arrayJson = join(tmp, "array.json");
      writeFileSync(arrayJson, "[1, 2, 3]");
      expect(() => parseConfigFile(arrayJson)).toThrow(HarnessError);

      const nullJson = join(tmp, "null.json");
      writeFileSync(nullJson, "null");
      expect(() => parseConfigFile(nullJson)).toThrow(HarnessError);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("parseConfigFile validates and parses all supported keys", () => {
    const tmp = makeTmpDir("config-parser-valid-");
    try {
      const configPath = join(tmp, "harness.config.json");
      const validPayload = {
        min_adversarial_probes: 2,
        max_repair_rounds: 3,
        max_branch_depth: 2,
        max_agents: 10,
        max_output_bytes: 4096,
        default_lease_seconds: 600,
        default_max_parallel: 4,
        max_concurrent_agents: 4,
        gate_max_parallel: 2,
        worktree_isolation: true,
        worktree_root: ".worktrees",
        branch_prefix: "olt/",
        commit_per_subphase: false,
        max_commit_lines: 500,
        rebase_on_complete: true,
        supervisory_cadence_seconds: 30,
        quota_freeze_threshold_pct: 80,
        fleet_agent_ceiling: 8,
        model_by_role: { coordinator: "claude-3-5-sonnet" },
      };
      writeFileSync(configPath, JSON.stringify(validPayload));
      const parsed = parseConfigFile(configPath);
      expect(parsed).not.toBeNull();
      expect(parsed?.min_adversarial_probes).toBe(2);
      expect(parsed?.max_repair_rounds).toBe(3);
      expect(parsed?.max_branch_depth).toBe(2);
      expect(parsed?.max_agents).toBe(10);
      expect(parsed?.max_output_bytes).toBe(4096);
      expect(parsed?.default_lease_seconds).toBe(600);
      expect(parsed?.default_max_parallel).toBe(4);
      expect(parsed?.gate_max_parallel).toBe(2);
      expect(parsed?.worktree_isolation).toBe(true);
      expect(parsed?.worktree_root).toBe(".worktrees");
      expect(parsed?.branch_prefix).toBe("olt/");
      expect(parsed?.commit_per_subphase).toBe(false);
      expect(parsed?.max_commit_lines).toBe(500);
      expect(parsed?.rebase_on_complete).toBe(true);
      expect(parsed?.supervisory_cadence_seconds).toEqual(attestedFact(30));
      expect(parsed?.quota_freeze_threshold_pct).toEqual(attestedFact(80));
      expect(parsed?.fleet_agent_ceiling).toEqual(attestedFact(8));
      expect(parsed?.model_by_role).toEqual(attestedFact({ coordinator: "claude-3-5-sonnet" }));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("parseConfigFile rejects unsupported keys and bad values", () => {
    const tmp = makeTmpDir("config-parser-invalid-");
    try {
      const testCases = [
        { key: "unsupported_key", val: 123 },
        { key: "default_lease_seconds", val: 999999 },
        { key: "worktree_isolation", val: "true" },
        { key: "worktree_root", val: "   " },
        { key: "quota_freeze_threshold_pct", val: 150 },
        { key: "model_by_role", val: { bad_role: "model" } },
        { key: "fleet_agent_ceiling", val: 0 },
      ];
      for (let i = 0; i < testCases.length; i++) {
        const file = join(tmp, `test_${i}.json`);
        writeFileSync(file, JSON.stringify({ [testCases[i].key]: testCases[i].val }));
        expect(() => parseConfigFile(file)).toThrow(HarnessError);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("parsePolicyLayer parses valid and invalid policy files", () => {
    expect(parsePolicyLayer("/nonexistent/policy.json")).toBeNull();
    const tmp = makeTmpDir("policy-layer-tests-");
    try {
      const valid = join(tmp, "policy_valid.json");
      writeFileSync(valid, JSON.stringify({ quota_freeze_threshold_pct: 75 }));
      expect(parsePolicyLayer(valid)).toEqual({
        quota_freeze_threshold_pct: attestedFact(75),
      });

      const badVal = join(tmp, "policy_bad_val.json");
      writeFileSync(badVal, JSON.stringify({ quota_freeze_threshold_pct: "not a number" }));
      expect(parsePolicyLayer(badVal)).toEqual({
        quota_freeze_threshold_pct: unreadableFact(null),
      });

      const badJson = join(tmp, "policy_bad_json.json");
      writeFileSync(badJson, "invalid json");
      expect(parsePolicyLayer(badJson)).toEqual({
        quota_freeze_threshold_pct: unreadableFact(null),
      });

      const notAnObj = join(tmp, "policy_array.json");
      writeFileSync(notAnObj, "[1, 2]");
      expect(parsePolicyLayer(notAnObj)).toEqual({
        quota_freeze_threshold_pct: unreadableFact(null),
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("inspectHarnessConfigFile reports valid_custom, invalid_custom, and auto_detected", () => {
    const tmp = makeTmpDir("inspect-config-tests-");
    try {
      const missing = join(tmp, "nonexistent.json");
      expect(inspectHarnessConfigFile(missing).status).toBe("auto_detected");

      const valid = join(tmp, "valid.json");
      writeFileSync(valid, JSON.stringify({ max_repair_rounds: 5 }));
      const validRes = inspectHarnessConfigFile(valid);
      expect(validRes.status).toBe("valid_custom");
      expect(validRes.partial.max_repair_rounds).toBe(5);

      const invalid = join(tmp, "invalid.json");
      writeFileSync(invalid, "{ bad json");
      const invalidRes = inspectHarnessConfigFile(invalid);
      expect(invalidRes.status).toBe("invalid_custom");
      expect(invalidRes.error).toBeDefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("core/config/env.ts", () => {
  beforeEach(() => {
    resetHarnessConfigCache();
  });

  it("quotaProvenanceSource resolves source correctly", () => {
    expect(quotaProvenanceSource(attestedFact(50))).toBe("config_override");
    expect(quotaProvenanceSource(unreadableFact(null))).toBe("unreadable");
    expect(quotaProvenanceSource(unattestedFact(null))).toBe("assumed_default");
  });

  it("resolveQuotaFreezeThresholdFact resolves precedence: repo > capsule > policy > default", () => {
    const factRepo = resolveQuotaFreezeThresholdFact(
      { quota_freeze_threshold_pct: attestedFact(10) },
      { quota_freeze_threshold_pct: attestedFact(20) },
      { quota_freeze_threshold_pct: attestedFact(30) },
    );
    expect(factRepo).toEqual(attestedFact(30));

    const factCapsule = resolveQuotaFreezeThresholdFact(
      { quota_freeze_threshold_pct: attestedFact(10) },
      { quota_freeze_threshold_pct: attestedFact(20) },
      null,
    );
    expect(factCapsule).toEqual(attestedFact(20));

    const factPolicy = resolveQuotaFreezeThresholdFact(
      { quota_freeze_threshold_pct: attestedFact(10) },
      null,
      null,
    );
    expect(factPolicy).toEqual(attestedFact(10));

    const factDefault = resolveQuotaFreezeThresholdFact(null, null, null);
    expect(factDefault).toEqual(DEFAULT_CONFIG.quota_freeze_threshold_pct);
  });

  it("resolveConcurrencyCeiling resolves precedence of explicit override, max_concurrent_agents, host discovery, or default", () => {
    expect(
      resolveConcurrencyCeiling(
        { default_max_parallel: 8 },
        { default_max_parallel: 12 },
        null,
      ),
    ).toEqual({
      default_max_parallel: 12,
      default_max_parallel_source: "config_override",
    });

    expect(
      resolveConcurrencyCeiling(
        { max_concurrent_agents: 6 },
        null,
        null,
      ),
    ).toEqual({
      default_max_parallel: 6,
      default_max_parallel_source: "config_override",
    });

    expect(
      resolveConcurrencyCeiling(
        null,
        null,
        { value: 4, hostTool: "antigravity" },
      ),
    ).toEqual({
      default_max_parallel: 4,
      default_max_parallel_source: "host_discovered",
    });

    expect(
      resolveConcurrencyCeiling(
        null,
        null,
        null,
      ),
    ).toEqual({
      default_max_parallel: DEFAULT_CONFIG.default_max_parallel,
      default_max_parallel_source: "assumed_default",
    });
  });

  it("resolveHarnessConfig and getHarnessConfig caching", () => {
    const tmp = makeTmpDir("resolve-harness-tests-");
    try {
      const repoCfg = join(tmp, "harness.config.json");
      writeFileSync(repoCfg, JSON.stringify({ max_agents: 7, gate_max_parallel: 3 }));
      const capDir = join(tmp, "capsule");
      mkdirSync(capDir, { recursive: true });
      const capCfg = join(capDir, "config.json");
      writeFileSync(capCfg, JSON.stringify({ default_lease_seconds: 300 }));

      const resolved = resolveHarnessConfig(tmp, capDir, { cpuCount: 8 });
      expect(resolved.max_agents).toBe(7);
      expect(resolved.max_active_grants_per_run).toBe(7);
      expect(resolved.default_lease_seconds).toBe(300);
      expect(resolved.gate_max_parallel).toBe(3);

      const key = cacheKey(tmp, capDir);
      expect(key).toContain(tmp);
      const cached = getHarnessConfig(tmp, capDir);
      expect(cached).toBe(getHarnessConfig(tmp, capDir));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("core/config/cadence.ts", () => {
  it("isCadenceWakeKind and isCadenceWakeReferenceFrame validate allowed values", () => {
    for (const k of CADENCE_WAKE_KINDS) {
      expect(isCadenceWakeKind(k)).toBe(true);
    }
    expect(isCadenceWakeKind("other")).toBe(false);
    expect(isCadenceWakeKind(123)).toBe(false);

    for (const f of CADENCE_WAKE_REFERENCE_FRAMES) {
      expect(isCadenceWakeReferenceFrame(f)).toBe(true);
    }
    expect(isCadenceWakeReferenceFrame("other")).toBe(false);
  });

  it("classifyCadenceWake classifies activity and crash recovery", () => {
    expect(classifyCadenceWake("activity-recovery")).toBe("recovery_fired");
    expect(classifyCadenceWake("crash-recovery")).toBe("recovery_fired");
    expect(classifyCadenceWake("unknown-mech")).toBe("unknown");
    expect(classifyCadenceWake(null)).toBe("unknown");
    expect(classifyCadenceWake(undefined)).toBe("unknown");
  });

  it("classifyCadenceWakeInstant produces wake instant record", () => {
    const instant = classifyCadenceWakeInstant({
      atMs: 1000,
      armMechanism: "activity-recovery",
      referenceFrame: "deadline_relative",
    });
    expect(instant).toEqual({
      atMs: 1000,
      kind: "recovery_fired",
      referenceFrame: "deadline_relative",
    });
  });

  it("resolveSupervisoryCadence validates constraints", () => {
    const valid = resolveSupervisoryCadence({
      armIntervalSeconds: 30,
      armIntervalSource: "config_override",
      deadlineSeconds: 60,
      deadlineSource: "assumed_default",
      graceSeconds: 10,
      wakeDriver: attestedFact(true),
    });
    expect(valid.arm_interval_seconds).toBe(30);
    expect(valid.max_safe_arm_interval_seconds).toBe(50);
    expect(valid.wake_driver_attested).toBe(true);

    // Negative / non-integer values
    expect(() =>
      resolveSupervisoryCadence({
        armIntervalSeconds: 0,
        armIntervalSource: "config_override",
        deadlineSeconds: 60,
        deadlineSource: "assumed_default",
        graceSeconds: 10,
      }),
    ).toThrow(HarnessError);

    // Deadline <= grace
    expect(() =>
      resolveSupervisoryCadence({
        armIntervalSeconds: 30,
        armIntervalSource: "config_override",
        deadlineSeconds: 10,
        deadlineSource: "assumed_default",
        graceSeconds: 10,
      }),
    ).toThrow(HarnessError);

    // Arm interval >= deadline
    expect(() =>
      resolveSupervisoryCadence({
        armIntervalSeconds: 60,
        armIntervalSource: "config_override",
        deadlineSeconds: 60,
        deadlineSource: "assumed_default",
        graceSeconds: 5,
      }),
    ).toThrow(HarnessError);

    // Arm interval > maxSafeArmInterval
    expect(() =>
      resolveSupervisoryCadence({
        armIntervalSeconds: 55,
        armIntervalSource: "config_override",
        deadlineSeconds: 60,
        deadlineSource: "assumed_default",
        graceSeconds: 10,
      }),
    ).toThrow(HarnessError);
  });
});

describe("core/config/index.ts", () => {
  it("exports all required config symbols", () => {
    expect(CoreConfigIndex.DEFAULT_CONFIG).toBeDefined();
    expect(CoreConfigIndex.resolveHarnessConfig).toBeDefined();
    expect(CoreConfigIndex.getHarnessConfig).toBeDefined();
  });
});
