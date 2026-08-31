import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { quotaResumeCommand } from "../../../olt/scripts/src/cli/commands/quota-resume.ts";
import {
  persistDagSnapshot,
  type QuotaDagSnapshot,
} from "../../../olt/scripts/src/telemetry/dag-snapshot.ts";
import { QuotaCircuitBreaker } from "../../../olt/scripts/src/telemetry/circuit-breaker.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { findRepoRoot } from "../../../olt/scripts/src/core/shared/paths.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { setupCompiledRun } from "./task-ops-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

async function seedFrozenSnapshot(repoRoot: string, runRoot: string): Promise<void> {
  const snap: QuotaDagSnapshot = {
    version: "2",
    repositoryRoot: repoRoot,
    runRoot,
    frozenAt: new Date().toISOString(),
    status: "frozen",
    tasks: [],
    agents: [],
    cronsSuspended: [
      {
        cronId: "cron-1",
        expression: "*/5 * * * *",
        purpose: "telemetry",
      },
    ],
    uncommittedFiles: [],
    lowestQuotaObserved: 5,
    constrainedModels: ["claude-3-5-sonnet"],
    autoWakeSchedule: {
      resetTime: new Date(Date.now() + 3600000).toISOString(),
      resumeTime: new Date(Date.now() + 3660000).toISOString(),
    },
    activeWave: {
      waveIndex: 1,
      lanes: ["lane-1"],
    },
  };
  await persistDagSnapshot(snap);
}

describe("quota-resume CLI command", () => {
  test("throws HarnessError on invalid repo path mismatch", async () => {
    const { run } = await setupCompiledRun("quota-resume-path-safety", roots);

    const fakeRepo = join(tmpdir(), `fake-repo-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    roots.push(fakeRepo);
    mkdirSync(fakeRepo, { recursive: true });
    writeFileSync(join(fakeRepo, "package.json"), "{}", "utf-8");

    try {
      await quotaResumeCommand({
        run,
        repo: fakeRepo,
      });
      expect(true).toBeFalse();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(HarnessError);
      expect((err as HarnessError).code).toBe("PATH_SAFETY");
    }
  });

  test("resumes DAG snapshot with force flag bypassing circuit breaker", async () => {
    const { run } = await setupCompiledRun("quota-resume-force", roots);
    const loaded = loadRun(run, false);
    const verifiedRepo = findRepoRoot(loaded.runRoot);

    await seedFrozenSnapshot(verifiedRepo, loaded.runRoot);

    const result = await quotaResumeCommand({
      run,
      repo: verifiedRepo,
      force: true,
      json: true,
      detailed: true,
    });

    expect(result.status).toBe("resumed");
    expect(result.snapshot).toBeDefined();
    expect(result.json).toBe(true);
    expect(String(result.markdown)).toContain("DAG Resume State");
  });

  test("returns constrained status when circuit breaker triggers without force", async () => {
    const { run } = await setupCompiledRun("quota-resume-breaker-triggered", roots);
    const loaded = loadRun(run, false);
    const verifiedRepo = findRepoRoot(loaded.runRoot);

    const breakerSpy = spyOn(QuotaCircuitBreaker.prototype, "evaluate").mockReturnValue({
      isTriggered: true,
      reasons: ["Quota limit exceeded"],
      suggestedAction: "Wait for quota reset",
      metrics: {
        activeAgentsCount: 0,
        quotaUtilization: 95,
        thresholdPercentage: 10,
        rateLimitedCount: 1,
      },
    });

    const result = await quotaResumeCommand({
      run,
      repo: verifiedRepo,
      threshold: "NaN", // Exercises isNaN(threshold) branch
    });

    expect(result.status).toBe("constrained");
    expect(result.isTriggered).toBe(true);
    expect(String(result.message)).toContain("Quota is still constrained");

    breakerSpy.mockRestore();
  });

  test("resumes DAG snapshot when circuit breaker allows execution", async () => {
    const { run } = await setupCompiledRun("quota-resume-breaker-ok", roots);
    const loaded = loadRun(run, false);
    const verifiedRepo = findRepoRoot(loaded.runRoot);

    await seedFrozenSnapshot(verifiedRepo, loaded.runRoot);

    const breakerSpy = spyOn(QuotaCircuitBreaker.prototype, "evaluate").mockReturnValue({
      isTriggered: false,
      reasons: [],
      suggestedAction: "Proceed",
      metrics: {
        activeAgentsCount: 0,
        quotaUtilization: 5,
        thresholdPercentage: 20,
        rateLimitedCount: 0,
      },
    });

    // Test with repo flag omitted (default resolution)
    const result = await quotaResumeCommand({
      run,
      threshold: "20",
    });

    expect(result.status).toBe("resumed");
    expect(result.snapshot).toBeDefined();

    breakerSpy.mockRestore();
  });
});
