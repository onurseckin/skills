import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  resetHarnessConfigCache,
  resolveHarnessConfig,
} from "../../../olt/scripts/src/core/config/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("harness-config-provenance-precedence", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;
  const NO_HOST_CEILING = { hostConcurrency: null } as const;
  let dirCounter = 0;

  function makeTempDir(label: string): string {
    const dir = `/virtual/cfg-prov-prec-${++dirCounter}-${label}`;
    vfs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  beforeEach(() => {
    resetHarnessConfigCache();
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    if (session) {
      session.cleanup();
      session = null;
    }
  });

  describe("provenance generalisation — new config domains", () => {
    test("max_active_grants_per_run mirrors max_agents in value and provenance, additively", () => {
      const dir = makeTempDir("max-active-grants-default");
      const config = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
      expect(config.max_agents).toBe(100);
      expect(config.max_active_grants_per_run).toBe(100);
      expect(config.config_provenance.max_agents).toBe("assumed_default");
      expect(config.config_provenance.max_active_grants_per_run).toBe("assumed_default");

      vfs.writeFileSync(join(dir, "harness.config.json"), JSON.stringify({ max_agents: 15 }));
      const configured = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
      expect(configured.max_agents).toBe(15);
      expect(configured.max_active_grants_per_run).toBe(15);
      expect(configured.config_provenance.max_active_grants_per_run).toBe("config_override");
    });

    test("fleet_agent_ceiling is absent when nothing configures it, config_override when set", () => {
      const dir = makeTempDir("fleet-agent-ceiling-absent");
      const config = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
      expect(config.fleet_agent_ceiling).toEqual({ value: null, source: "absent" });

      vfs.writeFileSync(
        join(dir, "harness.config.json"),
        JSON.stringify({ fleet_agent_ceiling: 40 }),
      );
      const configured = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
      expect(configured.fleet_agent_ceiling).toEqual({ value: 40, source: "config_override" });
    });

    test("fleet_agent_ceiling rejects an invalid configured value", () => {
      const dir = makeTempDir("fleet-agent-ceiling-invalid");
      vfs.writeFileSync(
        join(dir, "harness.config.json"),
        JSON.stringify({ fleet_agent_ceiling: -3 }),
      );
      expect(() => resolveHarnessConfig(dir, undefined, NO_HOST_CEILING)).toThrow(HarnessError);
      expect(() => resolveHarnessConfig(dir, undefined, NO_HOST_CEILING)).toThrow(
        /fleet_agent_ceiling/i,
      );
    });

    test("supervisory_cadence_seconds is structurally unusable without confronting its source", () => {
      const dir = makeTempDir("supervisory-cadence-default");
      const defaultConfig = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
      expect(defaultConfig.supervisory_cadence_seconds).toEqual({ value: 900, source: "absent" });
      expect(defaultConfig.config_provenance.supervisory_cadence_seconds).toBe("assumed_default");

      vfs.writeFileSync(
        join(dir, "harness.config.json"),
        JSON.stringify({ supervisory_cadence_seconds: 600 }),
      );
      const configured = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
      expect(configured.supervisory_cadence_seconds).toEqual({
        value: 600,
        source: "config_override",
      });
      expect(configured.config_provenance.supervisory_cadence_seconds).toBe("config_override");
    });

    test("quota_freeze_threshold_pct is absent, not a fabricated percentage, until configured", () => {
      const dir = makeTempDir("quota-freeze-threshold-absent");
      const config = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
      expect(config.quota_freeze_threshold_pct).toEqual({ value: null, source: "absent" });

      vfs.writeFileSync(
        join(dir, "harness.config.json"),
        JSON.stringify({ quota_freeze_threshold_pct: 85 }),
      );
      const configured = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
      expect(configured.quota_freeze_threshold_pct).toEqual({
        value: 85,
        source: "config_override",
      });
      expect(configured.config_provenance.quota_freeze_threshold_pct).toBe("config_override");
    });

    test("model_by_role rejects every map when any role or model member is invalid", () => {
      const dir = makeTempDir("model-by-role");
      vfs.writeFileSync(
        join(dir, "harness.config.json"),
        JSON.stringify({ model_by_role: { implementer: "opus", "not-a-real-role": "x" } }),
      );
      expect(() => resolveHarnessConfig(dir, undefined, NO_HOST_CEILING)).toThrow(HarnessError);
      expect(() => resolveHarnessConfig(dir, undefined, NO_HOST_CEILING)).toThrow(/model_by_role/i);
    });

    test("rejects unknown harness keys while allowing valid partial configuration and policy schema keys", () => {
      const dir = makeTempDir("strict-unknown-key");
      vfs.writeFileSync(
        join(dir, "harness.config.json"),
        JSON.stringify({ max_agents: 12, typo_max_agnts: 13 }),
      );
      expect(() => resolveHarnessConfig(dir, undefined, NO_HOST_CEILING)).toThrow(HarnessError);
      expect(() => resolveHarnessConfig(dir, undefined, NO_HOST_CEILING)).toThrow(
        /typo_max_agnts/i,
      );

      vfs.writeFileSync(join(dir, "harness.config.json"), JSON.stringify({ max_agents: 12 }));
      expect(resolveHarnessConfig(dir, undefined, NO_HOST_CEILING).max_agents).toBe(12);

      vfs.mkdirSync(join(dir, ".olt"), { recursive: true });
      vfs.writeFileSync(
        join(dir, ".olt", "policy.json"),
        JSON.stringify({ schema_version: 1, ecosystem: "bun", quota_freeze_threshold_pct: 22 }),
      );
      const config = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
      expect(config.quota_freeze_threshold_pct).toEqual({ value: 22, source: "config_override" });

      vfs.writeFileSync(join(dir, ".olt", "policy.json"), "{ malformed");
      expect(
        resolveHarnessConfig(dir, undefined, NO_HOST_CEILING).quota_freeze_threshold_pct,
      ).toEqual({ value: null, source: "unreadable" });
    });

    test("host_profiles configured through resolveHarnessConfig refuses an unknown host id end to end", () => {
      const dir = makeTempDir("host-profiles-refusal-end-to-end");
      vfs.writeFileSync(
        join(dir, "harness.config.json"),
        JSON.stringify({ host_profiles: { generic: { timer_arming_mechanism: "none" } } }),
      );
      expect(() => resolveHarnessConfig(dir, undefined, NO_HOST_CEILING)).toThrow(HarnessError);
    });

    test("host_profiles configured through resolveHarnessConfig canonicalizes claude onto claude-code", () => {
      const dir = makeTempDir("host-profiles-canonicalize-end-to-end");
      vfs.writeFileSync(
        join(dir, "harness.config.json"),
        JSON.stringify({ host_profiles: { claude: { self_wake_supported: true } } }),
      );
      const config = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
      expect(config.host_profiles.source).toBe("config_override");
      expect(config.host_profiles.value["claude-code"]?.self_wake_supported).toEqual({
        value: true,
        source: "config_override",
      });
      expect(Object.keys(config.host_profiles.value)).toEqual(["claude-code"]);
      expect(config.config_provenance.host_profiles).toBe("config_override");
    });

    test("host_profiles is absent, not a fabricated empty map, until configured", () => {
      const dir = makeTempDir("host-profiles-default-absent");
      const config = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
      expect(config.host_profiles).toEqual({ value: {}, source: "absent" });
    });

    test("gate_max_parallel is tagged host_discovered by default, config_override once configured", () => {
      const dir = makeTempDir("gate-max-parallel-provenance");
      const discovered = resolveHarnessConfig(dir, undefined, { cpuCount: 10 });
      expect(discovered.config_provenance.gate_max_parallel).toBe("host_discovered");

      vfs.writeFileSync(join(dir, "harness.config.json"), JSON.stringify({ gate_max_parallel: 3 }));
      const configured = resolveHarnessConfig(dir, undefined, { cpuCount: 10 });
      expect(configured.config_provenance.gate_max_parallel).toBe("config_override");
    });

    test("default_max_parallel_source keeps working unchanged for existing 19+ call sites", () => {
      const dir = makeTempDir("default-max-parallel-source-unchanged");
      const config = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
      expect(config.default_max_parallel_source).toBe("assumed_default");
      expect(config.config_provenance.default_max_parallel).toBe("assumed_default");
    });
  });
});
