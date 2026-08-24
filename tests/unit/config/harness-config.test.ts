import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_RESOLVED_CONFIG,
  resolveHarnessConfig,
} from "../../../olt/scripts/src/core/config/harness-config.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

// scratchRoot() creates and tears itself down (see tests/support/README.md) — this file no longer
// needs the tempDirs[] + makeTempDir() + afterEach trio, previously copy-pasted once per describe
// block below with only the mkdtemp prefix differing between copies.
function makeTempDir(label: string): string {
  return scratchRoot(import.meta.path, label);
}

describe("harness-config", () => {
  // Host discovery (B27.2) reads the live environment, so any test that compares a resolution
  // against DEFAULT_RESOLVED_CONFIG must pin `hostConcurrency: null` — otherwise a real host that
  // happens to publish a concurrency ceiling in whatever environment the suite runs under would
  // make this assertion flaky. Dedicated coverage for the discovery/precedence behaviour itself
  // lives in the "B27" describe block below and in host-concurrency.test.ts.
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

    // An explicit default_max_parallel in the file always wins over host discovery (B27.2), so
    // this one is deterministic even without pinning NO_HOST_CEILING — pinned anyway for clarity.
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

  test("gracefully recovers from invalid JSON or non-object files", () => {
    const dir = makeTempDir("invalid-json-recovery");
    writeFileSync(join(dir, "harness.config.json"), "{ invalid-json }");

    const config = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
    expect(config).toEqual(DEFAULT_RESOLVED_CONFIG);

    writeFileSync(join(dir, "harness.config.json"), JSON.stringify(["not", "an", "object"]));
    const configArray = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
    expect(configArray).toEqual(DEFAULT_RESOLVED_CONFIG);

    writeFileSync(join(dir, "harness.config.json"), JSON.stringify(null));
    const configNull = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
    expect(configNull).toEqual(DEFAULT_RESOLVED_CONFIG);
  });

  test("ignores invalid field types and out-of-bounds values", () => {
    const dir = makeTempDir("invalid-field-types");
    const invalidFields = {
      max_repair_rounds: -1,
      max_output_bytes: 100, // below 1024 minimum
      default_lease_seconds: 2, // below 5s minimum
      default_max_parallel: 0,
    };
    writeFileSync(join(dir, "harness.config.json"), JSON.stringify(invalidFields));

    const config = resolveHarnessConfig(dir, undefined, NO_HOST_CEILING);
    expect(config).toEqual(DEFAULT_RESOLVED_CONFIG);
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

  test("ignores wrong-typed values and keeps the default for that field alone", () => {
    const dir = makeTempDir("worktree-wrong-types");
    writeFileSync(
      join(dir, "harness.config.json"),
      JSON.stringify({
        worktree_isolation: "yes",
        branch_prefix: "",
        max_commit_lines: 0,
      }),
    );
    const config = resolveHarnessConfig(dir);
    expect(config.worktree_isolation).toBe(false);
    expect(config.branch_prefix).toBe("harness/");
    expect(config.max_commit_lines).toBe(500);
  });
});
