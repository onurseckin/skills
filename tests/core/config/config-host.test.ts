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

describe("core/config/host-canon.ts", () => {
  it("canonicalizeHostId resolves exact providers, aliases, known unresolvable, and unrecognized", () => {
    expect(canonicalizeHostId(undefined)).toEqual({ kind: "absent" });
    expect(canonicalizeHostId("")).toEqual({ kind: "absent" });
    expect(canonicalizeHostId("   ")).toEqual({ kind: "absent" });
    expect(canonicalizeHostId("antigravity")).toEqual({ kind: "resolved", host: "antigravity" });
    expect(canonicalizeHostId("claude")).toEqual({ kind: "resolved", host: "claude-code" });
    expect(canonicalizeHostId("cursor")).toEqual({ kind: "resolved", host: "cursor" });
    expect(canonicalizeHostId("generic")).toEqual({ kind: "known_unresolvable", rawId: "generic" });
    expect(canonicalizeHostId("unknown-host-xyz")).toEqual({
      kind: "unrecognized",
      rawId: "unknown-host-xyz",
    });
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
    expect(canonicalHostFromOutcome({ kind: "resolved", host: "cursor" })).toEqual(
      attestedFact("cursor"),
    );
    expect(canonicalHostFromOutcome({ kind: "absent" })).toEqual(unattestedFact(null));
    expect(canonicalHostFromOutcome({ kind: "unrecognized", rawId: "bad" })).toEqual(
      unreadableFact(null),
    );
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

    expect(() => parseHostProfiles({ "unknown-host": {} }, "invalid.json")).toThrow(HarnessError);
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
