import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  PolicyEngine,
  createPolicyEngine,
  getGlobalPolicyEngine,
  resetGlobalPolicyEngine,
  type PolicyReloadResult,
} from "../../../olt/scripts/src/engine/policy-engine.ts";
import {
  CURRENT_POLICY_SCHEMA_VERSION,
  generateCanonicalDefaultPolicy,
  generateDefaultRepoPolicy,
  saveRepoPolicy,
  type RepoPolicy,
} from "../../../olt/scripts/src/policy/index.ts";
import {
  assertValidPolicy,
  isPolicyValid,
  validateCommandIntegrity,
  validateHooksIntegrity,
  validatePlanningPolicy,
  validatePolicy,
  validatePolicyStructure,
  validateReviewProtocol,
} from "../../../olt/scripts/src/policy/validator.ts";

describe("PolicyEngine and Policy Validator", () => {
  const scratchBase = join(process.cwd(), "coverage", "scratch", "engine-policy-engine-test");

  beforeEach(() => {
    resetGlobalPolicyEngine();
  });

  afterEach(() => {
    resetGlobalPolicyEngine();
  });

  afterAll(() => {
    rmSync(scratchBase, { recursive: true, force: true });
  });

  test("creates policy engine with auto-detected defaults when no policy file exists", () => {
    const dir = join(scratchBase, "defaults");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bun.lock"), "");

    const engine = createPolicyEngine({ repoRoot: dir });
    const policy = engine.getPolicy();

    expect(policy.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);
    expect(policy.ecosystem).toBe("bun");
    expect(policy.provenance).toBe("auto_detected");
    expect(typeof engine.getChecksum()).toBe("string");
    expect(engine.getRepoRoot()).toBe(dir);
  });

  test("loads custom policy and verifies policy path and checksum", () => {
    const dir = join(scratchBase, "custom-policy");
    mkdirSync(join(dir, ".olt"), { recursive: true });
    const canonical = generateCanonicalDefaultPolicy(dir);
    const customPolicy: RepoPolicy = {
      ...canonical,
      read_scope_neighborhood_depth: 6,
    };
    saveRepoPolicy(customPolicy, dir);

    const engine = new PolicyEngine({ repoRoot: dir });
    expect(engine.getPolicy().read_scope_neighborhood_depth).toBe(6);
    expect(engine.getPolicyPath()).toBe(join(dir, ".olt", "policy.json"));
  });

  test("detects drift when policy file changes on disk and reloads", async () => {
    const dir = join(scratchBase, "drift-test");
    mkdirSync(join(dir, ".olt"), { recursive: true });
    const canonical = generateCanonicalDefaultPolicy(dir);
    saveRepoPolicy(canonical, dir);

    const engine = createPolicyEngine({ repoRoot: dir });
    expect(engine.checkDrift().drifted).toBe(false);

    const updatedPolicy: RepoPolicy = {
      ...canonical,
      read_scope_neighborhood_depth: 9,
    };
    saveRepoPolicy(updatedPolicy, dir);

    const drift = engine.checkDrift();
    expect(drift.drifted).toBe(true);

    const reloadResult = await engine.reload();
    expect(reloadResult.reloaded).toBe(true);
    expect(engine.getPolicy().read_scope_neighborhood_depth).toBe(9);
    expect(engine.checkDrift().drifted).toBe(false);
  });

  test("subscribes to policy reload events and fires listeners", async () => {
    const dir = join(scratchBase, "listeners-test");
    mkdirSync(join(dir, ".olt"), { recursive: true });
    const canonical = generateCanonicalDefaultPolicy(dir);
    saveRepoPolicy(canonical, dir);

    const engine = createPolicyEngine({ repoRoot: dir });
    const events: string[] = [];

    const unsubscribe = engine.subscribe((newPolicy, event) => {
      events.push(`${event.type}:${newPolicy.read_scope_neighborhood_depth}`);
    });

    const updatedPolicy: RepoPolicy = {
      ...canonical,
      read_scope_neighborhood_depth: 4,
    };
    saveRepoPolicy(updatedPolicy, dir);
    await engine.reload();

    expect(events.length).toBe(1);
    expect(events[0]).toBe("POLICY_RELOAD_EVENT:4");

    unsubscribe();

    const anotherPolicy: RepoPolicy = {
      ...canonical,
      read_scope_neighborhood_depth: 5,
    };
    saveRepoPolicy(anotherPolicy, dir);
    await engine.reload();

    expect(events.length).toBe(1);
  });

  test("updates policy atomically via updatePolicy and updates in-memory state", () => {
    const dir = join(scratchBase, "update-policy-test");
    mkdirSync(join(dir, ".olt"), { recursive: true });
    const canonical = generateCanonicalDefaultPolicy(dir);
    saveRepoPolicy(canonical, dir);

    const engine = createPolicyEngine({ repoRoot: dir });
    const savedPath = engine.updatePolicy((current) => ({
      ...current,
      read_scope_neighborhood_depth: 12,
    }));

    expect(savedPath).toBe(join(dir, ".olt", "policy.json"));
    expect(engine.getPolicy().read_scope_neighborhood_depth).toBe(12);
  });

  test("manages auto-reload timer lifecycle", () => {
    const dir = join(scratchBase, "auto-reload-test");
    mkdirSync(dir, { recursive: true });

    const engine = createPolicyEngine({ repoRoot: dir, autoReloadIntervalMs: 100 });
    expect(engine.isAutoReloadRunning()).toBe(true);

    engine.stopAutoReload();
    expect(engine.isAutoReloadRunning()).toBe(false);

    engine.startAutoReload(200);
    expect(engine.isAutoReloadRunning()).toBe(true);

    engine.stopAutoReload();
    expect(engine.isAutoReloadRunning()).toBe(false);
  });

  test("provides global singleton instance and reset", () => {
    const dir = join(scratchBase, "global-singleton");
    mkdirSync(dir, { recursive: true });

    const e1 = getGlobalPolicyEngine({ repoRoot: dir });
    const e2 = getGlobalPolicyEngine();
    expect(e1).toBe(e2);

    resetGlobalPolicyEngine();
    const e3 = getGlobalPolicyEngine({ repoRoot: dir });
    expect(e3).not.toBe(e1);
  });

  test("verifies command authorization via verifyCommand", () => {
    const dir = join(scratchBase, "auth-command");
    mkdirSync(dir, { recursive: true });

    const engine = createPolicyEngine({ repoRoot: dir });
    const result = engine.verifyCommand("git status", "implementer");
    expect(typeof result.authorized).toBe("boolean");
  });

  test("validator module validates policy structures correctly", () => {
    const canonical = generateDefaultRepoPolicy();

    expect(isPolicyValid(canonical)).toBe(true);
    expect(isPolicyValid({ schema_version: "invalid" })).toBe(false);

    const parsed = validatePolicy(canonical);
    expect(parsed.schema_version).toBe(CURRENT_POLICY_SCHEMA_VERSION);

    expect(() => assertValidPolicy(canonical)).not.toThrow();
    expect(() => assertValidPolicy(null)).toThrow(HarnessError);

    const structureSuccess = validatePolicyStructure(canonical);
    expect(structureSuccess.valid).toBe(true);
    expect(structureSuccess.errors.length).toBe(0);

    const structureFail = validatePolicyStructure({ forbidden_commands: "not an array" });
    expect(structureFail.valid).toBe(false);
    expect(structureFail.errors.length).toBeGreaterThan(0);
  });

  test("validator module detects command conflicts and invalid planning/review/hooks", () => {
    const cmdErrors = validateCommandIntegrity(["bun test"], ["bun test", "rm -rf /"]);
    expect(cmdErrors.length).toBe(1);
    expect(cmdErrors[0]).toContain("bun test");

    const planningErrors = validatePlanningPolicy({
      mandatory_brainstorming_rounds: -1,
      min_tasks_per_complex_prompt: 0,
      max_files_per_task: 0,
    });
    expect(planningErrors.length).toBe(3);

    const reviewErrors = validateReviewProtocol({
      max_adversarial_pushes: 0,
      cognitive_pushes: -2,
    });
    expect(reviewErrors.length).toBe(2);

    const hookErrors = validateHooksIntegrity({
      on_wave_complete: ["valid command", ""],
      on_release_push: "not an array",
    });
    expect(hookErrors.length).toBe(2);
  });
});
