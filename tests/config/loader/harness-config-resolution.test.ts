import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  DEFAULT_RESOLVED_CONFIG,
  resetHarnessConfigCache,
  resolveHarnessConfig,
} from "../../../olt/scripts/src/core/config/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("harness-config-resolution", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;
  const NO_HOST_CEILING = { hostConcurrency: null } as const;
  let dirCounter = 0;

  function makeTempDir(label: string): string {
    const dir = `/virtual/cfg-res-${++dirCounter}-${label}`;
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
    vfs.writeFileSync(join(dir, "harness.config.json"), JSON.stringify(custom));

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
    vfs.writeFileSync(join(dir, ".harness.config.json"), JSON.stringify(custom));

    const config = resolveHarnessConfig(dir);
    expect(config.max_repair_rounds).toBe(7);
    expect(config.max_output_bytes).toBe(DEFAULT_RESOLVED_CONFIG.max_output_bytes);
    expect(config.default_lease_seconds).toBe(DEFAULT_RESOLVED_CONFIG.default_lease_seconds);
  });

  test("prefers harness.config.json over .harness.config.json", () => {
    const dir = makeTempDir("prefers-harness-config-json");
    vfs.writeFileSync(join(dir, "harness.config.json"), JSON.stringify({ max_repair_rounds: 10 }));
    vfs.writeFileSync(join(dir, ".harness.config.json"), JSON.stringify({ max_repair_rounds: 3 }));

    const config = resolveHarnessConfig(dir);
    expect(config.max_repair_rounds).toBe(10);
  });

  test("applies capsule config and merges repo config over it", () => {
    const repoDir = makeTempDir("repo-layer");
    const capDir = makeTempDir("capsule-layer");

    vfs.writeFileSync(
      join(capDir, "config.json"),
      JSON.stringify({ max_repair_rounds: 4, default_max_parallel: 8 }),
    );
    vfs.writeFileSync(
      join(repoDir, "harness.config.json"),
      JSON.stringify({ max_repair_rounds: 6 }),
    );

    const config = resolveHarnessConfig(repoDir, capDir);
    expect(config.max_repair_rounds).toBe(6);
    expect(config.default_max_parallel).toBe(8);
    expect(config.default_lease_seconds).toBe(DEFAULT_RESOLVED_CONFIG.default_lease_seconds);
  });

  test("falls back to capsule harness.config.json when capsule config.json is absent", () => {
    const repoDir = makeTempDir("repo-layer-capsule-fallback");
    const capDir = makeTempDir("capsule-layer-fallback");

    vfs.writeFileSync(
      join(capDir, "harness.config.json"),
      JSON.stringify({ max_repair_rounds: 9 }),
    );

    const config = resolveHarnessConfig(repoDir, capDir, NO_HOST_CEILING);
    expect(config.max_repair_rounds).toBe(9);
  });

  test("refuses malformed JSON or non-object files rather than silently defaulting", () => {
    const dir = makeTempDir("invalid-json-refusal");
    vfs.writeFileSync(join(dir, "harness.config.json"), "{ invalid-json }");
    expect(() => resolveHarnessConfig(dir, undefined, NO_HOST_CEILING)).toThrow(HarnessError);
    expect(() => resolveHarnessConfig(dir, undefined, NO_HOST_CEILING)).toThrow(/not valid JSON/);

    vfs.writeFileSync(join(dir, "harness.config.json"), JSON.stringify(["not", "an", "object"]));
    expect(() => resolveHarnessConfig(dir, undefined, NO_HOST_CEILING)).toThrow(HarnessError);
    expect(() => resolveHarnessConfig(dir, undefined, NO_HOST_CEILING)).toThrow(
      /JSON object at its root/,
    );

    vfs.writeFileSync(join(dir, "harness.config.json"), JSON.stringify(null));
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
    vfs.writeFileSync(join(dir, "harness.config.json"), JSON.stringify(invalidFields));

    expect(() => resolveHarnessConfig(dir, undefined, NO_HOST_CEILING)).toThrow(HarnessError);
    expect(() => resolveHarnessConfig(dir, undefined, NO_HOST_CEILING)).toThrow(
      /harness\.config\.json.*max_repair_rounds/i,
    );
  });
});
