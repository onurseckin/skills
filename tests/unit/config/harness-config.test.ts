import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import {
  DEFAULT_RESOLVED_CONFIG,
  resolveHarnessConfig,
} from "../../../olt/scripts/src/core/config/harness-config.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

function makeTempDir(label: string): string {
  return scratchRoot(import.meta.path, label);
}

describe("harness-config", () => {
  const NO_HOST_CEILING = { hostConcurrency: null } as const;

  test("returns DEFAULT_RESOLVED_CONFIG when no config file exists", () => {
    const dir = makeTempDir("no-config-file");
    const config = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
    expect(config).toEqual(DEFAULT_RESOLVED_CONFIG);
    expect(config.max_repair_rounds).toBe(DEFAULT_RESOLVED_CONFIG.max_repair_rounds);
    expect(config.max_branch_depth).toBe(5);
    expect(config.max_agents).toBe(100);
    expect(config.max_output_bytes).toBe(10 * 1024 * 1024);
    expect(config.default_lease_seconds).toBe(1800);
    expect(config.default_max_parallel).toBe(4);
  });

  test("loads settings from harness.config.json in repo root", () => {
    const dir = makeTempDir("harness-config-json");
    const custom = {
      max_repair_rounds: 8,
      max_branch_depth: 3,
      max_agents: 12,
      max_output_bytes: 5 * 1024 * 1024,
      default_lease_seconds: 900,
      default_max_parallel: 2,
    };
    writeFileSync(join(dir, "harness.config.json"), JSON.stringify(custom));

    const config = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
    expect(config).toEqual({
      ...custom,
      min_adversarial_probes: DEFAULT_RESOLVED_CONFIG.min_adversarial_probes,
      gate_max_parallel: DEFAULT_RESOLVED_CONFIG.gate_max_parallel,
      default_max_parallel_source: "config_override",
      worktree_isolation: DEFAULT_RESOLVED_CONFIG.worktree_isolation,
      branch_prefix: DEFAULT_RESOLVED_CONFIG.branch_prefix,
      commit_per_subphase: DEFAULT_RESOLVED_CONFIG.commit_per_subphase,
      max_commit_lines: DEFAULT_RESOLVED_CONFIG.max_commit_lines,
      rebase_on_complete: DEFAULT_RESOLVED_CONFIG.rebase_on_complete,
      supervisory_cadence_seconds: DEFAULT_RESOLVED_CONFIG.supervisory_cadence_seconds,
      quota_freeze_threshold_pct: DEFAULT_RESOLVED_CONFIG.quota_freeze_threshold_pct,
      host_profiles: DEFAULT_RESOLVED_CONFIG.host_profiles,
      model_by_role: DEFAULT_RESOLVED_CONFIG.model_by_role,
      fleet_agent_ceiling: DEFAULT_RESOLVED_CONFIG.fleet_agent_ceiling,
      max_active_grants_per_run: custom.max_agents,
      config_provenance: {
        ...DEFAULT_RESOLVED_CONFIG.config_provenance,
        max_repair_rounds: "config_override",
        max_branch_depth: "config_override",
        max_agents: "config_override",
        max_active_grants_per_run: "config_override",
        max_output_bytes: "config_override",
        default_lease_seconds: "config_override",
        default_max_parallel: "config_override",
      },
    });
  });

  test("loads settings from .harness.config.json when harness.config.json is absent", () => {
    const dir = makeTempDir("dotfile-config");
    const custom = {
      max_repair_rounds: 7,
    };
    writeFileSync(join(dir, ".harness.config.json"), JSON.stringify(custom));

    const config = resolveHarnessConfig(dir);
    expect(config.max_repair_rounds).toBe(7);
    expect(config.max_output_bytes).toBe(DEFAULT_RESOLVED_CONFIG.max_output_bytes);
    expect(config.default_lease_seconds).toBe(DEFAULT_RESOLVED_CONFIG.default_lease_seconds);
  });

  test("prefers harness.config.json over .harness.config.json", () => {
    const dir = makeTempDir("prefers-harness-config-json");
    writeFileSync(join(dir, "harness.config.json"), JSON.stringify({ max_repair_rounds: 10 }));
    writeFileSync(join(dir, ".harness.config.json"), JSON.stringify({ max_repair_rounds: 3 }));

    const config = resolveHarnessConfig(dir);
    expect(config.max_repair_rounds).toBe(10);
  });

  test("applies capsule config and merges repo config over it", () => {
    const repoDir = makeTempDir("repo-layer");
    const capDir = makeTempDir("capsule-layer");

    writeFileSync(
      join(capDir, "config.json"),
      JSON.stringify({ max_repair_rounds: 4, default_max_parallel: 8 }),
    );
    writeFileSync(join(repoDir, "harness.config.json"), JSON.stringify({ max_repair_rounds: 6 }));

    const config = resolveHarnessConfig(repoDir, capDir);
    expect(config.max_repair_rounds).toBe(6);
    expect(config.default_max_parallel).toBe(8);
    expect(config.default_lease_seconds).toBe(DEFAULT_RESOLVED_CONFIG.default_lease_seconds);
  });

  test("falls back to capsule harness.config.json when capsule config.json is absent", () => {
    const repoDir = makeTempDir("repo-layer-capsule-fallback");
    const capDir = makeTempDir("capsule-layer-fallback");

    writeFileSync(join(capDir, "harness.config.json"), JSON.stringify({ max_repair_rounds: 9 }));

    const config = resolveHarnessConfig(repoDir, capDir, NO_HOST_CEILING);
    expect(config.max_repair_rounds).toBe(9);
  });

  test("refuses malformed JSON or non-object files rather than silently defaulting", () => {
    const dir = makeTempDir("invalid-json-refusal");
    writeFileSync(join(dir, "harness.config.json"), "{ invalid-json }");
    expect(() => resolveHarnessConfig(dir, undefined, NO_HOST_CEILING)).toThrow(HarnessError);
    expect(() => resolveHarnessConfig(dir, undefined, NO_HOST_CEILING)).toThrow(/not valid JSON/);

    writeFileSync(join(dir, "harness.config.json"), JSON.stringify(["not", "an", "object"]));
    expect(() => resolveHarnessConfig(dir, undefined, NO_HOST_CEILING)).toThrow(HarnessError);
    expect(() => resolveHarnessConfig(dir, undefined, NO_HOST_CEILING)).toThrow(
      /JSON object at its root/,
    );

    writeFileSync(join(dir, "harness.config.json"), JSON.stringify(null));
    expect(() => resolveHarnessConfig(dir, undefined, NO_HOST_CEILING)).toThrow(HarnessError);
    expect(() => resolveHarnessConfig(dir, undefined, NO_HOST_CEILING)).toThrow(
      /JSON object at its root/,
    );
  });

  test("still returns DEFAULT_RESOLVED_CONFIG when the file is simply absent", () => {
    const dir = makeTempDir("absent-config-file-is-not-a-refusal");
    const config = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
    expect(config).toEqual(DEFAULT_RESOLVED_CONFIG);
  });

  test("rejects present invalid field types and out-of-bounds values", () => {
    const dir = makeTempDir("invalid-field-types");
    const invalidFields = {
      max_repair_rounds: -1,
      max_output_bytes: 100,
      default_lease_seconds: 2,
      default_max_parallel: 0,
    };
    writeFileSync(join(dir, "harness.config.json"), JSON.stringify(invalidFields));

    expect(() => resolveHarnessConfig(dir, undefined, NO_HOST_CEILING)).toThrow(HarnessError);
    expect(() => resolveHarnessConfig(dir, undefined, NO_HOST_CEILING)).toThrow(
      /harness\.config\.json.*max_repair_rounds/i,
    );
  });
});

describe("B27.2 — concurrency ceiling discovery and precedence", () => {
  test("uses a host-discovered ceiling when nothing local overrides it", () => {
    const dir = makeTempDir("host-discovered-ceiling");
    const config = resolveHarnessConfig(dir, undefined, {
      hostConcurrency: { value: 20, hostTool: "claude-code" },
    });
    expect(config.default_max_parallel).toBe(20);
    expect(config.default_max_parallel_source).toBe("host_discovered");
  });

  test("an explicit default_max_parallel in the repo config beats host discovery", () => {
    const dir = makeTempDir("explicit-beats-host");
    writeFileSync(join(dir, "harness.config.json"), JSON.stringify({ default_max_parallel: 3 }));
    const config = resolveHarnessConfig(dir, undefined, {
      hostConcurrency: { value: 20, hostTool: "claude-code" },
    });
    expect(config.default_max_parallel).toBe(3);
    expect(config.default_max_parallel_source).toBe("config_override");
  });

  test("an explicit max_concurrent_agents beats host discovery but not an explicit default_max_parallel", () => {
    const dir = makeTempDir("max-concurrent-agents-precedence");
    writeFileSync(join(dir, "harness.config.json"), JSON.stringify({ max_concurrent_agents: 9 }));
    const withoutParallelOverride = resolveHarnessConfig(dir, undefined, {
      hostConcurrency: { value: 20, hostTool: "codex" },
    });
    expect(withoutParallelOverride.default_max_parallel).toBe(9);
    expect(withoutParallelOverride.default_max_parallel_source).toBe("config_override");

    writeFileSync(
      join(dir, "harness.config.json"),
      JSON.stringify({ max_concurrent_agents: 9, default_max_parallel: 3 }),
    );
    const withBoth = resolveHarnessConfig(dir, undefined, {
      hostConcurrency: { value: 20, hostTool: "codex" },
    });
    expect(withBoth.default_max_parallel).toBe(3);
  });

  test("falls back to the assumed default only when the host publishes nothing and nothing is configured", () => {
    const dir = makeTempDir("assumed-default-fallback");
    const config = resolveHarnessConfig(dir, undefined, { hostConcurrency: null });
    expect(config.default_max_parallel).toBe(4);
    expect(config.default_max_parallel_source).toBe("assumed_default");
  });

  test("derives gate_max_parallel from cores by default — a separate, lower ceiling", () => {
    const dir = makeTempDir("gate-max-parallel-default");
    const config = resolveHarnessConfig(dir, undefined, { cpuCount: 10 });
    expect(config.gate_max_parallel).toBe(5);
  });

  test("a configured gate_max_parallel overrides the cores-derived default", () => {
    const dir = makeTempDir("gate-max-parallel-override");
    writeFileSync(join(dir, "harness.config.json"), JSON.stringify({ gate_max_parallel: 7 }));
    const config = resolveHarnessConfig(dir, undefined, { cpuCount: 10 });
    expect(config.gate_max_parallel).toBe(7);
  });

  test("the general ceiling and the gate ceiling resolve independently of each other", () => {
    const dir = makeTempDir("independent-ceilings");
    const config = resolveHarnessConfig(dir, undefined, {
      hostConcurrency: { value: 40, hostTool: "claude-code" },
      cpuCount: 10,
    });
    expect(config.default_max_parallel).toBe(40);
    expect(config.gate_max_parallel).toBe(5);
  });
});

describe("B22.7 — worktree-isolation config knobs", () => {
  test("defaults: isolation off, no configured root, benign defaults for the rest", () => {
    const config = resolveHarnessConfig(makeTempDir("worktree-defaults"));
    expect(config.worktree_isolation).toBe(false);
    expect(config.worktree_root).toBeUndefined();
    expect(config.branch_prefix).toBe("harness/");
    expect(config.commit_per_subphase).toBe(true);
    expect(config.max_commit_lines).toBe(500);
  });

  test("reads every worktree knob from harness.config.json", () => {
    const dir = makeTempDir("worktree-knobs");
    writeFileSync(
      join(dir, "harness.config.json"),
      JSON.stringify({
        worktree_isolation: true,
        worktree_root: "../custom-worktrees",
        branch_prefix: "wt/",
        commit_per_subphase: false,
        max_commit_lines: 200,
      }),
    );
    const config = resolveHarnessConfig(dir);
    expect(config.worktree_isolation).toBe(true);
    expect(config.worktree_root).toBe("../custom-worktrees");
    expect(config.branch_prefix).toBe("wt/");
    expect(config.commit_per_subphase).toBe(false);
    expect(config.max_commit_lines).toBe(200);
  });

  test("rejects present wrong-typed worktree values rather than treating them as absent", () => {
    const dir = makeTempDir("worktree-wrong-types");
    writeFileSync(
      join(dir, "harness.config.json"),
      JSON.stringify({
        worktree_isolation: "yes",
      }),
    );
    expect(() => resolveHarnessConfig(dir)).toThrow(HarnessError);
    expect(() => resolveHarnessConfig(dir)).toThrow(/worktree_isolation/i);
  });
});

describe("provenance generalisation — new config domains", () => {
  const NO_HOST_CEILING = { hostConcurrency: null } as const;

  test("max_active_grants_per_run mirrors max_agents in value and provenance, additively", () => {
    const dir = makeTempDir("max-active-grants-default");
    const config = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
    expect(config.max_agents).toBe(100);
    expect(config.max_active_grants_per_run).toBe(100);
    expect(config.config_provenance.max_agents).toBe("assumed_default");
    expect(config.config_provenance.max_active_grants_per_run).toBe("assumed_default");

    writeFileSync(join(dir, "harness.config.json"), JSON.stringify({ max_agents: 15 }));
    const configured = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
    expect(configured.max_agents).toBe(15);
    expect(configured.max_active_grants_per_run).toBe(15);
    expect(configured.config_provenance.max_active_grants_per_run).toBe("config_override");
  });

  test("fleet_agent_ceiling is absent when nothing configures it, config_override when set — never assumed_default", () => {
    const dir = makeTempDir("fleet-agent-ceiling-absent");
    const config = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
    expect(config.fleet_agent_ceiling).toEqual({ value: null, source: "absent" });

    writeFileSync(join(dir, "harness.config.json"), JSON.stringify({ fleet_agent_ceiling: 40 }));
    const configured = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
    expect(configured.fleet_agent_ceiling).toEqual({ value: 40, source: "config_override" });
  });

  test("fleet_agent_ceiling rejects an invalid configured value rather than claiming it is absent", () => {
    const dir = makeTempDir("fleet-agent-ceiling-invalid");
    writeFileSync(join(dir, "harness.config.json"), JSON.stringify({ fleet_agent_ceiling: -3 }));
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

    writeFileSync(
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

    writeFileSync(
      join(dir, "harness.config.json"),
      JSON.stringify({ quota_freeze_threshold_pct: 85 }),
    );
    const configured = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
    expect(configured.quota_freeze_threshold_pct).toEqual({ value: 85, source: "config_override" });
    expect(configured.config_provenance.quota_freeze_threshold_pct).toBe("config_override");
  });

  test("model_by_role rejects every map when any role or model member is invalid", () => {
    const dir = makeTempDir("model-by-role");
    writeFileSync(
      join(dir, "harness.config.json"),
      JSON.stringify({ model_by_role: { implementer: "opus", "not-a-real-role": "x" } }),
    );
    expect(() => resolveHarnessConfig(dir, undefined, NO_HOST_CEILING)).toThrow(HarnessError);
    expect(() => resolveHarnessConfig(dir, undefined, NO_HOST_CEILING)).toThrow(/model_by_role/i);
  });

  test("rejects unknown harness keys while allowing valid partial configuration and policy schema keys", () => {
    const dir = makeTempDir("strict-unknown-key");
    writeFileSync(
      join(dir, "harness.config.json"),
      JSON.stringify({ max_agents: 12, typo_max_agnts: 13 }),
    );
    expect(() => resolveHarnessConfig(dir, undefined, NO_HOST_CEILING)).toThrow(HarnessError);
    expect(() => resolveHarnessConfig(dir, undefined, NO_HOST_CEILING)).toThrow(/typo_max_agnts/i);

    writeFileSync(join(dir, "harness.config.json"), JSON.stringify({ max_agents: 12 }));
    expect(resolveHarnessConfig(dir, undefined, NO_HOST_CEILING).max_agents).toBe(12);

    mkdirSync(join(dir, ".olt"), { recursive: true });
    writeFileSync(
      join(dir, ".olt", "policy.json"),
      JSON.stringify({ schema_version: 1, ecosystem: "bun", quota_freeze_threshold_pct: 22 }),
    );
    const config = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
    expect(config.quota_freeze_threshold_pct).toEqual({ value: 22, source: "config_override" });

    writeFileSync(join(dir, ".olt", "policy.json"), "{ malformed");
    expect(
      resolveHarnessConfig(dir, undefined, NO_HOST_CEILING).quota_freeze_threshold_pct,
    ).toEqual({
      value: null,
      source: "unreadable",
    });
  });

  test("host_profiles configured through resolveHarnessConfig refuses an unknown host id end to end", () => {
    const dir = makeTempDir("host-profiles-refusal-end-to-end");
    writeFileSync(
      join(dir, "harness.config.json"),
      JSON.stringify({ host_profiles: { generic: { timer_arming_mechanism: "none" } } }),
    );
    expect(() => resolveHarnessConfig(dir, undefined, NO_HOST_CEILING)).toThrow(HarnessError);
  });

  test("host_profiles configured through resolveHarnessConfig canonicalizes claude onto claude-code", () => {
    const dir = makeTempDir("host-profiles-canonicalize-end-to-end");
    writeFileSync(
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

    writeFileSync(join(dir, "harness.config.json"), JSON.stringify({ gate_max_parallel: 3 }));
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
