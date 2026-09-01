import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
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
  unattestedFact,
  unreadableFact,
  attestedFact,
} from "../../../olt/scripts/src/core/config/provenance.ts";
import { DEFAULT_CONFIG } from "../../../olt/scripts/src/core/config/defaults.ts";
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

describe("core/config/env.ts", () => {
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    resetHarnessConfigCache();
    mockFiles.clear();
    mockDirs.clear();
    spies.push(
      spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return mockFiles.has(s) || mockDirs.has(s);
      }),
      spyOn(fs, "readFileSync").mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        const val = mockFiles.get(s);
        if (val !== undefined) return val;
        throw new Error(`ENOENT: no such file, open '${s}'`);
      }),
    );
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
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
      resolveConcurrencyCeiling({ default_max_parallel: 8 }, { default_max_parallel: 12 }, null),
    ).toEqual({
      default_max_parallel: 12,
      default_max_parallel_source: "config_override",
    });

    expect(resolveConcurrencyCeiling({ max_concurrent_agents: 6 }, null, null)).toEqual({
      default_max_parallel: 6,
      default_max_parallel_source: "config_override",
    });

    expect(resolveConcurrencyCeiling(null, null, { value: 4, hostTool: "antigravity" })).toEqual({
      default_max_parallel: 4,
      default_max_parallel_source: "host_discovered",
    });

    expect(resolveConcurrencyCeiling(null, null, null)).toEqual({
      default_max_parallel: DEFAULT_CONFIG.default_max_parallel,
      default_max_parallel_source: "assumed_default",
    });
  });

  it("resolveHarnessConfig and getHarnessConfig caching", () => {
    const vRoot = "/virtual-resolve-harness-tests";
    const repoCfg = join(vRoot, "harness.config.json");
    mockFiles.set(repoCfg, JSON.stringify({ max_agents: 7, gate_max_parallel: 3 }));
    const capDir = join(vRoot, "capsule");
    mockDirs.add(capDir);
    const capCfg = join(capDir, "config.json");
    mockFiles.set(capCfg, JSON.stringify({ default_lease_seconds: 300 }));

    const resolved = resolveHarnessConfig(vRoot, capDir, { cpuCount: 8 });
    expect(resolved.max_agents).toBe(7);
    expect(resolved.max_active_grants_per_run).toBe(7);
    expect(resolved.default_lease_seconds).toBe(300);
    expect(resolved.gate_max_parallel).toBe(3);

    const key = cacheKey(vRoot, capDir);
    expect(key).toContain(vRoot);
    const cached = getHarnessConfig(vRoot, capDir);
    expect(cached).toBe(getHarnessConfig(vRoot, capDir));
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
