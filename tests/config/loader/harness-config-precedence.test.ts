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

describe("harness-config-precedence", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;
  let dirCounter = 0;

  function makeTempDir(label: string): string {
    const dir = `/virtual/cfg-prec-${++dirCounter}-${label}`;
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
      vfs.writeFileSync(
        join(dir, "harness.config.json"),
        JSON.stringify({ default_max_parallel: 3 }),
      );
      const config = resolveHarnessConfig(dir, undefined, {
        hostConcurrency: { value: 20, hostTool: "claude-code" },
      });
      expect(config.default_max_parallel).toBe(3);
      expect(config.default_max_parallel_source).toBe("config_override");
    });

    test("an explicit max_concurrent_agents beats host discovery but not an explicit default_max_parallel", () => {
      const dir = makeTempDir("max-concurrent-agents-precedence");
      vfs.writeFileSync(
        join(dir, "harness.config.json"),
        JSON.stringify({ max_concurrent_agents: 9 }),
      );
      const withoutParallelOverride = resolveHarnessConfig(dir, undefined, {
        hostConcurrency: { value: 20, hostTool: "codex" },
      });
      expect(withoutParallelOverride.default_max_parallel).toBe(9);
      expect(withoutParallelOverride.default_max_parallel_source).toBe("config_override");

      vfs.writeFileSync(
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
      vfs.writeFileSync(join(dir, "harness.config.json"), JSON.stringify({ gate_max_parallel: 7 }));
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
      vfs.writeFileSync(
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
      vfs.writeFileSync(
        join(dir, "harness.config.json"),
        JSON.stringify({ worktree_isolation: "yes" }),
      );
      expect(() => resolveHarnessConfig(dir)).toThrow(HarnessError);
      expect(() => resolveHarnessConfig(dir)).toThrow(/worktree_isolation/i);
    });
  });
});
