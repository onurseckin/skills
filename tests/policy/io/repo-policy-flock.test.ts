import { describe, expect, test, afterAll } from "bun:test";
import { spawn } from "node:child_process";
import { closeSync, constants, mkdirSync, openSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  CURRENT_POLICY_SCHEMA_VERSION,
  initRepoPolicy,
  loadRepoPolicy,
} from "../../../olt/scripts/src/policy/index.ts";
import {
  resolvePolicyLocation,
  resolveSystemLockPath,
  withLock,
} from "../../../olt/scripts/src/policy/io-safety.ts";
import { releaseFlock, tryExclusiveFlock } from "../../../olt/scripts/src/platform/index.ts";

describe("Repo Policy Flocking, Concurrency & Lock Management", () => {
  const scratchBase = join(process.cwd(), "coverage", "scratch", "repo-policy-flock-test");

  afterAll(() => {
    rmSync(scratchBase, { recursive: true, force: true });
  });

  test("concurrent processes serialize writes with flock and expose valid json", async () => {
    const dir = join(
      scratchBase,
      `concurrent-flock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    mkdirSync(dir, { recursive: true });
    initRepoPolicy(dir);

    const helperScript = join(dir, "worker.ts");
    writeFileSync(
      helperScript,
      `
import { saveRepoPolicy, loadRepoPolicy } from "${resolve(process.cwd(), "olt/scripts/src/policy/repo-policy.ts")}";
const dir = "${dir}";
for (let i = 0; i < 5; i++) {
  try {
    const p = loadRepoPolicy(dir);
    saveRepoPolicy({ ...p, read_scope_neighborhood_depth: i + 1 }, dir);
  } catch {
    const p = loadRepoPolicy(dir);
    saveRepoPolicy({ ...p, read_scope_neighborhood_depth: i + 1 }, dir);
  }
}
`,
      "utf-8",
    );

    const spawnWorker = () =>
      new Promise<number>((resolveExit) => {
        const proc = spawn("bun", [helperScript], { stdio: "ignore" });
        proc.on("exit", (code) => resolveExit(code ?? 1));
      });

    const results = await Promise.all([spawnWorker(), spawnWorker(), spawnWorker()]);
    expect(results.every((code) => code === 0)).toBe(true);

    const finalPolicy = loadRepoPolicy(dir);
    expect(finalPolicy.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);
    expect(finalPolicy.read_scope_neighborhood_depth).toBeGreaterThan(0);

    rmSync(dir, { recursive: true, force: true });
  });

  test("validates resolveSystemLockPath safety constraints", () => {
    const root = process.cwd();
    expect(resolveSystemLockPath("policy.lock", root)).toBe(
      join(root, ".olt", "locks", "policy.lock"),
    );

    expect(() => resolveSystemLockPath(123 as unknown as string)).toThrow(/non-empty string/);
    expect(() => resolveSystemLockPath("")).toThrow(/non-empty string/);
    expect(() => resolveSystemLockPath("   ")).toThrow(/non-empty string/);
    expect(() => resolveSystemLockPath(".")).toThrow(/Invalid lockName/);
    expect(() => resolveSystemLockPath("..")).toThrow(/Invalid lockName/);
    expect(() => resolveSystemLockPath("path/with/slash")).toThrow(/Invalid lockName/);
    expect(() => resolveSystemLockPath("path\\with\\backslash")).toThrow(/Invalid lockName/);
    expect(() => resolveSystemLockPath("path\0null")).toThrow(/Invalid lockName/);
  });

  test("withLock prevents nested re-entry on the same repo root and manages system flock", () => {
    const dir = join(scratchBase, "lock-reentry-test");
    mkdirSync(dir, { recursive: true });
    try {
      const loc = resolvePolicyLocation(dir, undefined, true);
      expect(
        withLock(loc, () => {
          expect(() => withLock(loc, () => {})).toThrow(/already active/);
          return 42;
        }),
      ).toBe(42);

      // Test withLock when lock is already held externally
      const lockPath = resolveSystemLockPath("policy.lock", loc.root);
      const holderFd = openSync(
        lockPath,
        constants.O_RDWR | constants.O_CREAT,
        0o600,
      );
      expect(tryExclusiveFlock(holderFd)).toBe(true);
      try {
        releaseFlock(holderFd);
      } finally {
        closeSync(holderFd);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
