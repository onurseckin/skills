import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import { quotaCheckCommand } from "../../../../../olt/scripts/src/cli/commands/quota-check.ts";
import { quotaFreezeCommand } from "../../../../../olt/scripts/src/cli/commands/quota-freeze.ts";
import { QuotaCircuitBreaker } from "../../../../../olt/scripts/src/telemetry/circuit-breaker.ts";
import { findRepoRoot } from "../../../../../olt/scripts/src/core/shared/paths.ts";
import { initCapsuleRun, loadRun } from "../../../../../olt/scripts/src/engine/store/index.ts";
import type { CollectorEnvironment } from "../../../../../olt/scripts/src/telemetry/collectors/index.ts";
import {
  cleanupVirtualCliFS,
  getVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";

beforeEach(() => {
  setupVirtualCliFS();
});

afterEach(() => {
  cleanupVirtualCliFS();
});

function setupQuotaRun(name: string): { repo: string; run: string } {
  const repo = `/virtual/cli/quota-${name}`;
  const vfs = getVirtualCliFS();
  vfs.mkdirSync(join(repo, ".git"), { recursive: true });
  vfs.writeFileSync(join(repo, "package.json"), "{}");
  const { runRoot } = initCapsuleRun(`quota-${name}`, { repo });
  return { repo, run: runRoot };
}

describe("quota-check CLI command", () => {
  test("runs quota check with default settings when healthy", async () => {
    const breakerSpy = spyOn(QuotaCircuitBreaker.prototype, "evaluate").mockReturnValue({
      status: "healthy",
      isTriggered: false,
      thresholdPercentage: 10,
      lowestRemainingQuota: 85,
      constrainedModels: [],
      wrapUpDirectives: [],
      autoWakeSchedule: undefined,
      summary: "Quota healthy across all platforms",
      reasons: [],
    });

    const res = await quotaCheckCommand({
      threshold: "15",
      "active-agents": 2,
      detailed: true,
      json: true,
    });

    expect(res.status).toBe("healthy");
    expect(res.isTriggered).toBe(false);
    expect(res.json).toBe(true);
    expect(String(res.markdown)).not.toContain("Initiate a DAG freeze");

    breakerSpy.mockRestore();
  });

  test("runs quota check with platform filter and handles triggered breaker", async () => {
    const breakerSpy = spyOn(QuotaCircuitBreaker.prototype, "evaluate").mockReturnValue({
      status: "constrained",
      isTriggered: true,
      thresholdPercentage: 10,
      lowestRemainingQuota: 5,
      constrainedModels: [
        { platformId: "anthropic", modelName: "claude-3-5-sonnet", remainingPercentage: 5 },
      ],
      wrapUpDirectives: ["Wrap up running tasks"],
      autoWakeSchedule: {
        targetWakeupIso: new Date(Date.now() + 3600000).toISOString(),
        durationSeconds: 3600,
        timerCondition: "any",
        activeAgentsCount: 0,
      },
      summary: "Quota exhausted for Anthropic",
      reasons: ["Anthropic remaining quota below threshold"],
    });

    const mockEnv: CollectorEnvironment = {
      processEnv: { ANTHROPIC_API_KEY: "test-key" },
    };

    const res = await quotaCheckCommand(
      {
        platform: "anthropic",
        threshold: "NaN",
      },
      undefined,
      undefined,
      mockEnv,
    );

    expect(res.status).toBe("constrained");
    expect(res.isTriggered).toBe(true);
    expect(String(res.markdown)).toContain("quota:freeze");

    breakerSpy.mockRestore();
  });
});

describe("quota-freeze CLI command", () => {
  test("throws HarnessError on invalid repo path mismatch", async () => {
    const { run } = setupQuotaRun("freeze-path-safety");
    const fakeRepo = `/virtual/cli/fake-repo-${Date.now()}`;
    const vfs = getVirtualCliFS();
    vfs.mkdirSync(fakeRepo, { recursive: true });
    vfs.writeFileSync(join(fakeRepo, "package.json"), "{}");

    await expect(
      quotaFreezeCommand({
        run,
        repo: fakeRepo,
      }),
    ).rejects.toMatchObject({
      code: "PATH_SAFETY",
    });
  });

  test("skips freeze when quota is healthy and force is false", async () => {
    const { run } = setupQuotaRun("freeze-healthy");
    const loaded = loadRun(run, false);
    const verifiedRepo = findRepoRoot(loaded.runRoot);

    const breakerSpy = spyOn(QuotaCircuitBreaker.prototype, "evaluate").mockReturnValue({
      status: "healthy",
      isTriggered: false,
      thresholdPercentage: 10,
      lowestRemainingQuota: 90,
      constrainedModels: [],
      wrapUpDirectives: [],
      autoWakeSchedule: undefined,
      summary: "All healthy",
      reasons: [],
    });

    const res = await quotaFreezeCommand({
      run,
      repo: verifiedRepo,
      threshold: "10",
      json: true,
    });

    expect(res.status).toBe("healthy");
    expect(res.isTriggered).toBe(false);
    expect(String(res.message)).toContain("Quota is healthy. Use --force to freeze anyway.");

    breakerSpy.mockRestore();
  });

  test("forces freeze even when quota is healthy", async () => {
    const { run, repo } = setupQuotaRun("freeze-force");
    const loaded = loadRun(run, false);
    const verifiedRepo = findRepoRoot(loaded.runRoot);

    const breakerSpy = spyOn(QuotaCircuitBreaker.prototype, "evaluate").mockReturnValue({
      status: "healthy",
      isTriggered: false,
      thresholdPercentage: 10,
      lowestRemainingQuota: 90,
      constrainedModels: [],
      wrapUpDirectives: [],
      autoWakeSchedule: undefined,
      summary: "All healthy",
      reasons: [],
    });

    const res = await quotaFreezeCommand({
      run,
      repo: verifiedRepo,
      force: true,
      detailed: true,
    });

    expect(res.status).toBe("frozen");
    expect(res.snapshot).toBeDefined();

    breakerSpy.mockRestore();
  });

  test("freezes DAG automatically when quota is triggered", async () => {
    const { run, repo } = setupQuotaRun("freeze-triggered");
    const loaded = loadRun(run, false);
    const verifiedRepo = findRepoRoot(loaded.runRoot);

    const breakerSpy = spyOn(QuotaCircuitBreaker.prototype, "evaluate").mockReturnValue({
      status: "constrained",
      isTriggered: true,
      thresholdPercentage: 10,
      lowestRemainingQuota: 2,
      constrainedModels: [
        { platformId: "anthropic", modelName: "claude-3-5-sonnet", remainingPercentage: 2 },
      ],
      wrapUpDirectives: ["Wrap up"],
      autoWakeSchedule: {
        targetWakeupIso: new Date(Date.now() + 3600000).toISOString(),
        durationSeconds: 3600,
        timerCondition: "any",
        activeAgentsCount: 0,
      },
      summary: "Quota low",
      reasons: ["Quota low"],
    });

    const res = await quotaFreezeCommand({
      run,
      repo: verifiedRepo,
      threshold: "NaN",
      "active-agents": 1,
    });

    expect(res.status).toBe("frozen");
    expect(res.snapshot).toBeDefined();

    breakerSpy.mockRestore();
  });
});
