import { describe, expect, test, afterAll } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  checkAndHandlePolicyDrift,
  computePolicyChecksum,
  detectPolicyDrift,
  generateDefaultRepoPolicy,
  handlePolicyDrift,
  initRepoPolicy,
  loadRepoPolicy,
  saveRepoPolicy,
  type PolicyDriftCallbacks,
  type PolicyReloadEvent,
} from "../../../olt/scripts/src/policy/index.ts";

describe("SHA-256 Policy Drift Watchdog & Fleet Re-Arming (Task 1.3)", () => {
  const scratchBase = join(process.cwd(), "coverage", "scratch", "test-drift-detector");

  afterAll(() => {
    rmSync(scratchBase, { recursive: true, force: true });
  });

  test("computes valid SHA-256 hex checksum and detects zero drift on identical file", () => {
    const dir = join(scratchBase, "checksum-stability");
    mkdirSync(dir, { recursive: true });
    initRepoPolicy(dir);

    const hash1 = computePolicyChecksum(dir);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);

    const hash2 = computePolicyChecksum(dir);
    expect(hash1).toBe(hash2);

    const result = detectPolicyDrift(hash1, dir);
    expect(result.drifted).toBe(false);
    expect(result.currentChecksum).toBe(hash1);

    rmSync(dir, { recursive: true, force: true });
  });

  test("computes deterministic fallback checksum when policy file does not exist", () => {
    const dir = join(scratchBase, "missing-policy");
    mkdirSync(dir, { recursive: true });

    const hashMissing1 = computePolicyChecksum(dir);
    const hashMissing2 = computePolicyChecksum(dir);
    expect(hashMissing1).toMatch(/^[a-f0-9]{64}$/);
    expect(hashMissing1).toBe(hashMissing2);

    rmSync(dir, { recursive: true, force: true });
  });

  test("detects drift when single character is modified in policy file", () => {
    const dir = join(scratchBase, "single-char-mutation");
    mkdirSync(dir, { recursive: true });
    initRepoPolicy(dir);

    const initialChecksum = computePolicyChecksum(dir);
    const policy = loadRepoPolicy(dir);

    // Modify a single property
    saveRepoPolicy({ ...policy, read_scope_neighborhood_depth: 9 }, dir);

    const driftResult = detectPolicyDrift(initialChecksum, dir);
    expect(driftResult.drifted).toBe(true);
    expect(driftResult.currentChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(driftResult.currentChecksum).not.toBe(initialChecksum);

    rmSync(dir, { recursive: true, force: true });
  });

  test("handlePolicyDrift executes callbacks and writes POLICY_RELOAD_EVENT to events.jsonl", async () => {
    const dir = join(scratchBase, "callback-events");
    mkdirSync(dir, { recursive: true });
    initRepoPolicy(dir);

    const initialChecksum = computePolicyChecksum(dir);
    const updatedPolicy = { ...generateDefaultRepoPolicy(dir), read_scope_neighborhood_depth: 4 };
    saveRepoPolicy(updatedPolicy, dir);
    const newChecksum = computePolicyChecksum(dir);

    let driftDetectedCalled = false;
    let rearmSchedulerCalled = false;
    let loggedEvent: PolicyReloadEvent | undefined;

    const callbacks: PolicyDriftCallbacks = {
      onDriftDetected: (_newPol, oldC, newC) => {
        driftDetectedCalled = true;
        expect(oldC).toBe(initialChecksum);
        expect(newC).toBe(newChecksum);
      },
      rearmScheduler: (newPol) => {
        rearmSchedulerCalled = true;
        expect(newPol.read_scope_neighborhood_depth).toBe(4);
      },
      logEvent: (event) => {
        loggedEvent = event;
      },
    };

    await handlePolicyDrift(updatedPolicy, {
      previousChecksum: initialChecksum,
      currentChecksum: newChecksum,
      repoRoot: dir,
      callbacks,
    });

    expect(driftDetectedCalled).toBe(true);
    expect(rearmSchedulerCalled).toBe(true);
    expect(loggedEvent).toBeDefined();
    expect(loggedEvent!.type).toBe("POLICY_RELOAD_EVENT");
    expect(loggedEvent!.previous_checksum).toBe(initialChecksum);
    expect(loggedEvent!.new_checksum).toBe(newChecksum);
    expect(loggedEvent!.policy_path).toBe(join(dir, ".olt", "policy.json"));

    rmSync(dir, { recursive: true, force: true });
  });

  test("checkAndHandlePolicyDrift logs event to events.jsonl file when no custom logEvent callback is provided", async () => {
    const dir = join(scratchBase, "file-events-log");
    mkdirSync(dir, { recursive: true });
    initRepoPolicy(dir);

    const initialChecksum = computePolicyChecksum(dir);
    const updatedPolicy = { ...generateDefaultRepoPolicy(dir), read_scope_neighborhood_depth: 8 };
    saveRepoPolicy(updatedPolicy, dir);

    let schedulerRearmed = false;
    const result = await checkAndHandlePolicyDrift(initialChecksum, {
      repoRoot: dir,
      callbacks: {
        rearmScheduler: () => {
          schedulerRearmed = true;
        },
      },
    });

    expect(result.drifted).toBe(true);
    expect(schedulerRearmed).toBe(true);

    const eventsPath = join(dir, ".olt", "events.jsonl");
    expect(existsSync(eventsPath)).toBe(true);

    const lines = readFileSync(eventsPath, "utf-8").trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const lastEvent = JSON.parse(lines[lines.length - 1]!) as PolicyReloadEvent;
    expect(lastEvent.type).toBe("POLICY_RELOAD_EVENT");
    expect(lastEvent.previous_checksum).toBe(initialChecksum);
    expect(lastEvent.new_checksum).toBe(result.currentChecksum);

    rmSync(dir, { recursive: true, force: true });
  });

  test("checkAndHandlePolicyDrift performs a no-op when no drift occurs", async () => {
    const dir = join(scratchBase, "non-drift-noop");
    mkdirSync(dir, { recursive: true });
    initRepoPolicy(dir);

    const initialChecksum = computePolicyChecksum(dir);
    let driftDetectedCalled = false;
    let schedulerRearmed = false;
    let logEventCalled = false;

    const result = await checkAndHandlePolicyDrift(initialChecksum, {
      repoRoot: dir,
      callbacks: {
        onDriftDetected: () => {
          driftDetectedCalled = true;
        },
        rearmScheduler: () => {
          schedulerRearmed = true;
        },
        logEvent: () => {
          logEventCalled = true;
        },
      },
    });

    expect(result.drifted).toBe(false);
    expect(result.currentChecksum).toBe(initialChecksum);
    expect(driftDetectedCalled).toBe(false);
    expect(schedulerRearmed).toBe(false);
    expect(logEventCalled).toBe(false);

    const eventsPath = join(dir, ".olt", "events.jsonl");
    expect(existsSync(eventsPath)).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  test("checkAndHandlePolicyDrift supports custom policyPath and custom eventsLogPath", async () => {
    const dir = join(scratchBase, "custom-paths");
    mkdirSync(dir, { recursive: true });
    const customPolicyRel = join(".olt", "custom-policy.json");
    const customEventsRel = join(".olt", "custom-events.jsonl");
    const customEventsAbs = join(dir, customEventsRel);

    saveRepoPolicy(generateDefaultRepoPolicy(dir), dir, customPolicyRel);
    const initialChecksum = computePolicyChecksum(dir, customPolicyRel);


    const updatedPolicy = { ...generateDefaultRepoPolicy(dir), read_scope_neighborhood_depth: 3 };
    saveRepoPolicy(updatedPolicy, dir, customPolicyRel);

    const result = await checkAndHandlePolicyDrift(initialChecksum, {
      repoRoot: dir,
      customPath: customPolicyRel,
      eventsLogPath: customEventsAbs,
    });

    expect(result.drifted).toBe(true);
    expect(existsSync(customEventsAbs)).toBe(true);

    const lines = readFileSync(customEventsAbs, "utf-8").trim().split("\n");
    const lastEvent = JSON.parse(lines[lines.length - 1]!) as PolicyReloadEvent;
    expect(lastEvent.type).toBe("POLICY_RELOAD_EVENT");
    expect(lastEvent.policy_path).toBe(join(dir, customPolicyRel));
    expect(lastEvent.previous_checksum).toBe(initialChecksum);
    expect(lastEvent.new_checksum).toBe(result.currentChecksum);

    // Test when parent directory of custom eventsLogPath does not exist
    const nonExistentDir = join(scratchBase, "nonexistent-events-parent", "events.jsonl");
    await handlePolicyDrift(updatedPolicy, {
      previousChecksum: initialChecksum,
      currentChecksum: result.currentChecksum,
      repoRoot: dir,
      customPath: customPolicyRel,
      eventsLogPath: nonExistentDir,
    });
    expect(existsSync(nonExistentDir)).toBe(true);

    rmSync(dir, { recursive: true, force: true });
    rmSync(dirname(nonExistentDir), { recursive: true, force: true });
  });
});

