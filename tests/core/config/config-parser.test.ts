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
