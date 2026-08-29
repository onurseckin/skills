import { describe, expect, it } from "bun:test";
import {
  AssemblyStationRegistry,
  claimStation,
  createStation,
  landStation,
  verifyStation,
} from "../../../olt/scripts/src/orchestrator/station-landing.ts";
import {
  executeGitStagingInvariant,
  verifyGitStagingDurability,
} from "../../../olt/scripts/src/orchestrator/subdomain-staging.ts";

describe("Sub-Domain Completion Git Staging & Station Landing Engine (Task 2.3)", () => {
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

    // 1. Claim all
    const claimedCore = claimStation(stationCore);
    const claimedVal = claimStation(stationValidation);
    const claimedTool = claimStation(stationTooling);
    registry.updateStation(claimedCore);
    registry.updateStation(claimedVal);
    registry.updateStation(claimedTool);

    // 2. Land Core independently
    const verifiedCore = verifyStation(claimedCore);
    const { station: landedCore } = landStation(verifiedCore, {
      customGitRunner: () => "tree-sha-core",
    });
    registry.updateStation(landedCore);

    status = registry.getStatus();
    expect(status.landed_stations).toBe(1);
    expect(status.in_progress_stations).toBe(2);
    expect(status.is_all_landed).toBe(false);

    // 3. Land Validation independently
    const verifiedVal = verifyStation(claimedVal);
    const { station: landedVal } = landStation(verifiedVal, {
      customGitRunner: () => "tree-sha-val",
    });
    registry.updateStation(landedVal);

    status = registry.getStatus();
    expect(status.landed_stations).toBe(2);
    expect(status.in_progress_stations).toBe(1);

    // 4. Land Tooling
    const verifiedTool = verifyStation(claimedTool);
    const { station: landedTool } = landStation(verifiedTool, {
      customGitRunner: () => "tree-sha-tool",
    });
    registry.updateStation(landedTool);

    status = registry.getStatus();
    expect(status.landed_stations).toBe(3);
    expect(status.is_all_landed).toBe(true);
  });
});
