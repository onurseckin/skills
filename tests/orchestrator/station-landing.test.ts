import { describe, expect, it } from "bun:test";
import {
  AssemblyStationRegistry,
  claimStation,
  createStation,
  landPhaseRelease,
  landStation,
  verifyStation,
} from "../../olt/scripts/src/orchestrator/station-landing.ts";
import {
  executeGitStagingInvariant,
  verifyGitStagingDurability,
} from "../../olt/scripts/src/orchestrator/subdomain-staging.ts";
import type {
  ExecuteLifecycleHooksOptions,
  LifecycleHookExecutionResult,
  RepoPolicy,
} from "../../olt/scripts/src/policy/index.ts";

describe("Sub-Domain Completion Git Staging & Station Landing Engine (Task 2.3 & Task Hooks 7)", () => {
  it("executes Git staging invariant and produces durable blob safety record", () => {
    const executedCommands: string[] = [];
    const mockGitRunner = (cmd: string): string => {
      executedCommands.push(cmd);
      if (cmd.startsWith("git diff --cached")) {
        return "src/core/model.ts\nsrc/core/index.ts";
      }
      if (cmd.startsWith("git write-tree")) {
        return "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
      }
      return "";
    };

    const record = executeGitStagingInvariant({
      milestoneId: "m1-core",
      subdomain: "core",
      customGitRunner: mockGitRunner,
    });

    expect(executedCommands).toContain("git add -A");
    expect(executedCommands).toContain("git diff --cached --name-only");
    expect(executedCommands).toContain("git write-tree");
    expect(record.milestone_id).toBe("m1-core");
    expect(record.subdomain).toBe("core");
    expect(record.staged_files).toEqual(["src/core/model.ts", "src/core/index.ts"]);
    expect(record.git_index_sha).toBe("4b825dc642cb6eb9a060e54bf8d69288fbee4904");
    expect(record.blob_objects_written).toBe(2);
    expect(verifyGitStagingDurability(record)).toBe(true);
  });

  it("drives station lifecycle through claim, verification, and landing with Git staging", () => {
    const executedCommands: string[] = [];
    const mockGitRunner = (cmd: string): string => {
      executedCommands.push(cmd);
      return "mock-tree-sha-1234567890abcdef";
    };

    const station = createStation("station-core-1", "core", "wave-1", ["src/core/engine.ts"]);
    expect(station.status).toBe("PENDING");

    const claimed = claimStation(station);
    expect(claimed.status).toBe("IN_PROGRESS");
    expect(claimed.claimed_at).toBeDefined();

    const verified = verifyStation(claimed, { testPath: "tests/unit/core.test.ts", passed: true });
    expect(verified.status).toBe("VERIFIED");
    expect(verified.verified_at).toBeDefined();

    const { station: landed, stagingRecord } = landStation(verified, {
      customGitRunner: mockGitRunner,
    });

    expect(landed.status).toBe("LANDED");
    expect(landed.staging_record).toBeDefined();
    expect(stagingRecord.subdomain).toBe("core");
    expect(executedCommands.some((c) => c.startsWith("git add"))).toBe(true);
  });

  it("handles verification failure properly", () => {
    const station = createStation("station-fail-1", "validation", "wave-1", ["tests/f.ts"]);
    const claimed = claimStation(station);
    const failed = verifyStation(claimed, { testPath: "tests/f.ts", passed: false });
    expect(failed.status).toBe("FAILED");
  });

  it("allows independent asynchronous multi-station landings without blocking", () => {
    const registry = new AssemblyStationRegistry();

    const stationCore = createStation("station-a-core", "core", "wave-1", ["src/core/a.ts"]);
    const stationValidation = createStation("station-b-val", "validation", "wave-1", [
      "tests/b.ts",
    ]);
    const stationTooling = createStation("station-c-tool", "tooling", "wave-1", ["src/cli/c.ts"]);

    registry.registerStation(stationCore);
    registry.registerStation(stationValidation);
    registry.registerStation(stationTooling);

    let status = registry.getStatus();
    expect(status.total_stations).toBe(3);
    expect(status.pending_stations).toBe(3);
    expect(status.is_all_landed).toBe(false);

    const claimedCore = claimStation(stationCore);
    const claimedVal = claimStation(stationValidation);
    const claimedTool = claimStation(stationTooling);
    registry.updateStation(claimedCore);
    registry.updateStation(claimedVal);
    registry.updateStation(claimedTool);

    const verifiedCore = verifyStation(claimedCore);
    const { station: landedCore } = landStation(verifiedCore, {
      customGitRunner: () => "tree-sha-core",
    });
    registry.updateStation(landedCore);

    status = registry.getStatus();
    expect(status.landed_stations).toBe(1);
    expect(status.in_progress_stations).toBe(2);
    expect(status.is_all_landed).toBe(false);

    const verifiedVal = verifyStation(claimedVal);
    const { station: landedVal } = landStation(verifiedVal, {
      customGitRunner: () => "tree-sha-val",
    });
    registry.updateStation(landedVal);

    status = registry.getStatus();
    expect(status.landed_stations).toBe(2);
    expect(status.in_progress_stations).toBe(1);

    const verifiedTool = verifyStation(claimedTool);
    const { station: landedTool } = landStation(verifiedTool, {
      customGitRunner: () => "tree-sha-tool",
    });
    registry.updateStation(landedTool);

    status = registry.getStatus();
    expect(status.landed_stations).toBe(3);
    expect(status.is_all_landed).toBe(true);
  });

  it("triggers on_phase_completion lifecycle hook during landStation with correct context", () => {
    const invokedHooks: ExecuteLifecycleHooksOptions[] = [];
    const mockExecutor = (opts: ExecuteLifecycleHooksOptions): LifecycleHookExecutionResult => {
      invokedHooks.push(opts);
      return {
        event: opts.event,
        commandCount: 1,
        executedCommands: ["echo phase completed"],
        skipped: false,
        errors: [],
      };
    };

    const station = createStation("station-hook-1", "mind", "m1-mind", [
      "src/mind/a.ts",
      "src/mind/b.ts",
    ]);
    const claimed = claimStation(station);
    const verified = verifyStation(claimed, { testPath: "tests/mind.ts", passed: true });

    const startTime = Date.now() - 4000;
    const result = landStation(verified, {
      customGitRunner: () => "git-tree-sha-mind",
      customHookExecutor: mockExecutor,
      phaseName: "Mind Domain Assembly",
      commitSha: "custom-mind-sha",
      taskCount: 2,
      startedAt: startTime,
    });

    expect(result.station.status).toBe("LANDED");
    expect(result.hookExecutionResult).toBeDefined();
    expect(result.hookExecutionResult?.event).toBe("on_phase_completion");
    expect(result.hookExecutionResult?.commandCount).toBe(1);
    expect(invokedHooks.length).toBe(1);
    expect(invokedHooks[0]?.event).toBe("on_phase_completion");
    expect(invokedHooks[0]?.context.phaseName).toBe("Mind Domain Assembly");
    expect(invokedHooks[0]?.context.commitSha).toBe("custom-mind-sha");
    expect(invokedHooks[0]?.context.taskCount).toBe(2);
    expect(invokedHooks[0]?.context.status).toBe("SUCCESS");
    expect((invokedHooks[0]?.context.durationMs as number) >= 3500).toBe(true);
  });

  it("triggers on_phase_completion lifecycle hook during landPhaseRelease with correct context", () => {
    const invokedHooks: ExecuteLifecycleHooksOptions[] = [];
    const mockExecutor = (opts: ExecuteLifecycleHooksOptions): LifecycleHookExecutionResult => {
      invokedHooks.push(opts);
      return {
        event: opts.event,
        commandCount: 1,
        executedCommands: ["echo phase release completed"],
        skipped: false,
        errors: [],
      };
    };

    const startTime = Date.now() - 6000;
    const result = landPhaseRelease({
      phaseName: "Core Architecture Wave",
      startedAt: startTime,
      commitSha: "commit-sha-999",
      taskCount: 7,
      customHookExecutor: mockExecutor,
    });

    expect(result.success).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(5000);
    expect(result.hookExecutionResult).toBeDefined();
    expect(result.hookExecutionResult?.event).toBe("on_phase_completion");
    expect(invokedHooks.length).toBe(1);
    expect(invokedHooks[0]?.event).toBe("on_phase_completion");
    expect(invokedHooks[0]?.context.phaseName).toBe("Core Architecture Wave");
    expect(invokedHooks[0]?.context.commitSha).toBe("commit-sha-999");
    expect(invokedHooks[0]?.context.taskCount).toBe(7);
    expect(invokedHooks[0]?.context.status).toBe("SUCCESS");
    expect((invokedHooks[0]?.context.durationMs as number) >= 5000).toBe(true);
  });

  it("forwards custom RepoPolicy to hook executor in landStation and landPhaseRelease", () => {
    const passedPolicies: (RepoPolicy | undefined)[] = [];
    const mockExecutor = (opts: ExecuteLifecycleHooksOptions): LifecycleHookExecutionResult => {
      passedPolicies.push(opts.policy);
      return {
        event: opts.event,
        commandCount: 0,
        executedCommands: [],
        skipped: true,
        errors: [],
      };
    };

    const customPolicy: RepoPolicy = {
      schema_version: 1,
      ecosystem: "bun",
      hooks: {
        on_phase_completion: ["echo custom hook {phaseName}"],
      },
    };

    const station = createStation("station-policy-1", "tooling", "m1-tool", ["src/cli.ts"]);
    const claimed = claimStation(station);
    const verified = verifyStation(claimed);

    landStation(verified, {
      customGitRunner: () => "tree-sha-tool",
      customHookExecutor: mockExecutor,
      policy: customPolicy,
    });

    landPhaseRelease({
      phaseName: "Tooling Phase",
      startedAt: Date.now(),
      customHookExecutor: mockExecutor,
      policy: customPolicy,
    });

    expect(passedPolicies.length).toBe(2);
    expect(passedPolicies[0]).toEqual(customPolicy);
    expect(passedPolicies[1]).toEqual(customPolicy);
  });

  it("handles hook execution exceptions gracefully without crashing landing pipeline", () => {
    const throwingExecutor = (): LifecycleHookExecutionResult => {
      throw new Error("Hook execution catastrophic spawn error");
    };

    const station = createStation("station-err-1", "validation", "m1-val", ["tests/x.ts"]);
    const claimed = claimStation(station);
    const verified = verifyStation(claimed);

    const stationResult = landStation(verified, {
      customGitRunner: () => "tree-sha-err",
      customHookExecutor: throwingExecutor,
    });

    expect(stationResult.station.status).toBe("LANDED");
    expect(stationResult.hookExecutionResult).toBeDefined();
    expect(stationResult.hookExecutionResult?.errors.length).toBe(1);
    expect(stationResult.hookExecutionResult?.errors[0]).toContain(
      "Hook execution catastrophic spawn error",
    );

    const releaseResult = landPhaseRelease({
      phaseName: "Validation Phase",
      startedAt: Date.now() - 1000,
      customHookExecutor: throwingExecutor,
    });

    expect(releaseResult.success).toBe(true);
    expect(releaseResult.hookExecutionResult).toBeDefined();
    expect(releaseResult.hookExecutionResult?.errors.length).toBe(1);
    expect(releaseResult.hookExecutionResult?.errors[0]).toContain(
      "Hook execution catastrophic spawn error",
    );
  });
});
