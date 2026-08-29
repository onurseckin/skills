import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  CURRENT_POLICY_SCHEMA_VERSION,
  executePolicyHook,
  generateCanonicalDefaultPolicy,
  generateDefaultRepoPolicy,
  initRepoPolicy,
  inspectRepoPolicy,
  loadRepoPolicy,
  saveRepoPolicy,
  type HookSpawnRunner,
  type RepoPolicy,
} from "../../../olt/scripts/src/policy/index.ts";

describe("Central Policy & Lifecycle Hooks Engine", () => {
  const scratchBase = join(process.cwd(), "coverage", "scratch", "central-policy-engine-test");

  afterAll(() => {
    rmSync(scratchBase, { recursive: true, force: true });
  });

  function createMockSpawn(log: Array<{ command: string; detached: boolean }>): HookSpawnRunner {
    return (command, options) => {
      log.push({ command, detached: options.detached });
      return { unref: () => {} };
    };
  }

  test("loadRepoPolicy loads authoritative .olt/policy.json with schema validation and explicit provenance", () => {
    const dir = join(scratchBase, "valid-policy");
    mkdirSync(join(dir, ".olt"), { recursive: true });
    const policyPath = join(dir, ".olt", "policy.json");
    const canonical = generateCanonicalDefaultPolicy(dir);
    const customPolicy: RepoPolicy = {
      ...canonical,
      read_scope_neighborhood_depth: 5,
      hooks: {
        on_wave_complete: ["echo wave-done {phase_name}"],
        on_release_push: ["echo push-done {commit_sha}"],
      },
    };
    writeFileSync(policyPath, JSON.stringify(customPolicy, null, 2), "utf-8");

    const loaded = loadRepoPolicy(dir);
    expect(loaded.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);
    expect(loaded.read_scope_neighborhood_depth).toBe(5);
    expect(loaded.hooks?.on_wave_complete).toEqual(["echo wave-done {phase_name}"]);
    expect(loaded.provenance).toBe("explicit_custom");

    const inspected = inspectRepoPolicy(dir);
    expect(inspected.status).toBe("valid_custom");
    expect(inspected.filePath).toBe(policyPath);
    expect(inspected.provenance).toBe("explicit_custom");
  });

  test("loadRepoPolicy falls back to auto-detected default policy with auto_detected provenance when missing", () => {
    const dir = join(scratchBase, "missing-policy");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bun.lock"), "");

    const loaded = loadRepoPolicy(dir);
    expect(loaded.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);
    expect(loaded.ecosystem).toBe("bun");
    expect(loaded.provenance).toBe("auto_detected");

    const inspected = inspectRepoPolicy(dir);
    expect(inspected.status).toBe("auto_detected");
    expect(inspected.provenance).toBe("auto_detected");
  });

  test("loadRepoPolicy enforces fail-closed error handling on corrupt JSON and schema violations", () => {
    const corruptDir = join(scratchBase, "corrupt-json");
    mkdirSync(join(corruptDir, ".olt"), { recursive: true });
    writeFileSync(join(corruptDir, ".olt", "policy.json"), "{ invalid-json", "utf-8");

    expect(() => loadRepoPolicy(corruptDir)).toThrow(HarnessError);
    expect(() => loadRepoPolicy(corruptDir)).toThrow(/invalid/i);

    const invalidSchemaDir = join(scratchBase, "invalid-schema");
    mkdirSync(join(invalidSchemaDir, ".olt"), { recursive: true });
    writeFileSync(
      join(invalidSchemaDir, ".olt", "policy.json"),
      JSON.stringify({ schema_version: 999, unknown_key: "forbidden" }),
      "utf-8",
    );

    expect(() => loadRepoPolicy(invalidSchemaDir)).toThrow(HarnessError);
    expect(() => loadRepoPolicy(invalidSchemaDir)).toThrow(/invalid/i);
  });

  test("saveRepoPolicy and initRepoPolicy atomically write validated configuration", () => {
    const dir = join(scratchBase, "init-save");
    mkdirSync(dir, { recursive: true });

    const initialized = initRepoPolicy(dir);
    expect(initialized.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);

    const updated: RepoPolicy = { ...initialized, read_scope_neighborhood_depth: 8 };
    const savedPath = saveRepoPolicy(updated, dir);
    expect(savedPath).toBe(join(dir, ".olt", "policy.json"));

    const reloaded = loadRepoPolicy(dir);
    expect(reloaded.read_scope_neighborhood_depth).toBe(8);
  });

  test("executePolicyHook dispatches on_wave_complete and interpolates variables", async () => {
    const spawnLog: Array<{ command: string; detached: boolean }> = [];
    const mockSpawn = createMockSpawn(spawnLog);
    const policy: RepoPolicy = {
      ...generateDefaultRepoPolicy("/repo"),
      hooks: {
        on_wave_complete: ["echo wave-finished --phase '{phase_name}' --tasks {task_count}"],
      },
    };

    await executePolicyHook(
      "on_wave_complete",
      { phase_name: "alpha-wave", task_count: 7 },
      { policy, repoRoot: "/repo", customSpawn: mockSpawn },
    );

    expect(spawnLog.length).toBe(1);
    expect(spawnLog[0]?.command).toBe("echo wave-finished --phase 'alpha-wave' --tasks 7");
  });

  test("executePolicyHook dispatches on_release_push and on_wave_completion aliases", async () => {
    const spawnLog: Array<{ command: string; detached: boolean }> = [];
    const mockSpawn = createMockSpawn(spawnLog);
    const policy: RepoPolicy = {
      ...generateDefaultRepoPolicy("/repo"),
      hooks: {
        on_release_push: ["git-push-notify --sha '{commit_sha}'"],
        on_wave_completion: ["wave-notify --phase '{phase_name}'"],
      },
    };

    await executePolicyHook(
      "on_release_push",
      { commit_sha: "abc1234" },
      { policy, repoRoot: "/repo", customSpawn: mockSpawn },
    );

    await executePolicyHook(
      "on_wave_completion",
      { phase_name: "omega-phase" },
      { policy, repoRoot: "/repo", customSpawn: mockSpawn },
    );

    expect(spawnLog.length).toBe(2);
    expect(spawnLog[0]?.command).toBe("git-push-notify --sha 'abc1234'");
    expect(spawnLog[1]?.command).toBe("wave-notify --phase 'omega-phase'");
  });

  test("executePolicyHook executes smoothly when no hooks are configured", async () => {
    const spawnLog: Array<{ command: string; detached: boolean }> = [];
    const mockSpawn = createMockSpawn(spawnLog);
    const policy: RepoPolicy = {
      ...generateDefaultRepoPolicy("/repo"),
      hooks: {},
    };

    await executePolicyHook("on_release_push", {}, { policy, repoRoot: "/repo", customSpawn: mockSpawn });
    expect(spawnLog.length).toBe(0);
  });
});
