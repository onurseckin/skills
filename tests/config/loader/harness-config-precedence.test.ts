import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  resetHarnessConfigCache,
  resolveHarnessConfig,
} from "../../../olt/scripts/src/core/config/index.ts";

const writeFileSync = (p: fs.PathOrFileDescriptor, d: string | NodeJS.ArrayBufferView) =>
  fs.writeFileSync(p, d);

describe("harness-config-precedence", () => {
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();
  const spies: { mockRestore: () => void }[] = [];
  let dirCounter = 0;

  function makeTempDir(label: string): string {
    const dir = `/virtual/cfg-prec-${++dirCounter}-${label}`;
    mockDirs.add(dir);
    return dir;
  }

  const origExists = fs.existsSync.bind(fs);
  const origRead = fs.readFileSync.bind(fs);
  const isVirt = (s: string) => s.startsWith("/virtual/") || s.startsWith("/tmp/");

  beforeEach(() => {
    resetHarnessConfigCache();
    mockFiles.clear();
    mockDirs.clear();
    spies.push(
      spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) =>
        isVirt(String(p)) ? mockFiles.has(String(p)) || mockDirs.has(String(p)) : origExists(p),
      ),
      spyOn(fs, "mkdirSync").mockImplementation(((p: fs.PathLike) => {
        mockDirs.add(String(p));
        return undefined as unknown as string;
      }) as unknown as typeof fs.mkdirSync),
      spyOn(fs, "readFileSync").mockImplementation(((p: fs.PathOrFileDescriptor) => {
        if (isVirt(String(p))) {
          const val = mockFiles.get(String(p));
          if (val !== undefined) return val;
          throw new Error(`ENOENT: ${String(p)}`);
        }
        return origRead(p as never);
      }) as unknown as typeof fs.readFileSync),
      spyOn(fs, "writeFileSync").mockImplementation(((
        p: fs.PathOrFileDescriptor,
        d: string | NodeJS.ArrayBufferView,
      ) => {
        mockFiles.set(
          String(p),
          typeof d === "string"
            ? d
            : Buffer.from(d.buffer, d.byteOffset, d.byteLength).toString("utf8"),
        );
      }) as unknown as typeof fs.writeFileSync),
    );
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
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
        JSON.stringify({ worktree_isolation: "yes" }),
      );
      expect(() => resolveHarnessConfig(dir)).toThrow(HarnessError);
      expect(() => resolveHarnessConfig(dir)).toThrow(/worktree_isolation/i);
    });
  });
});
