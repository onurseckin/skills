import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { generateFleetReport } from "../../olt/scripts/src/reporting/unified/fleet-builder.ts";
import type { VirtualMemoryFS } from "../../olt/scripts/src/testing/virtual-fs/index.ts";
import { cleanupVirtualReportingFS, setupVirtualReportingFS, tempDir } from "./fixture.ts";

describe("Fleet Reporting - Self-Presence & Worktree Rollup", () => {
  let vfs: VirtualMemoryFS;

  function createTempRepo(prefix: string): string {
    const dir = tempDir(prefix);
    vfs.mkdirSync(join(dir, ".git"), { recursive: true });
    vfs.mkdirSync(join(dir, ".olt", "worktrees"), { recursive: true });
    vfs.mkdirSync(join(dir, ".olt", "capsules"), { recursive: true });
    return dir;
  }

  beforeEach(() => {
    vfs = setupVirtualReportingFS();
  });

  afterEach(() => {
    cleanupVirtualReportingFS();
  });

  it("injects calling agent from .session.json into agentRoster when not in capsule state", () => {
    const dir = createTempRepo("fleet-presence");
    const capDir = join(dir, ".olt", "capsules", "run-core");
    vfs.mkdirSync(capDir, { recursive: true });
    vfs.writeFileSync(
      join(capDir, "manifest.json"),
      JSON.stringify({ run_id: "run-core", title: "Core Run" }),
    );
    vfs.writeFileSync(
      join(capDir, "state.json"),
      JSON.stringify({
        agents: [{ id: "orch-1", role: "orchestrator", status: "active", tier: 1 }],
        tasks: {},
      }),
    );

    vfs.writeFileSync(
      join(dir, ".session.json"),
      JSON.stringify({ agent_id: "coord-self", role: "coordinator" }),
    );

    const fleet = generateFleetReport(dir);
    const injected = fleet.agentRoster.find((a) => a.agentId === "coord-self");
    expect(injected).toBeDefined();
    expect(injected?.role).toBe("coordinator");
    expect(injected?.tier).toBe(2);
    expect(injected?.status).toBe("active");
    expect(injected?.fleetId).toBe("run-core");
    expect(fleet.stats.totalSubagents).toBe(2);
  });

  it("binds calling agent to 'session' when no active capsules exist", () => {
    const dir = createTempRepo("fleet-session-only");
    vfs.writeFileSync(
      join(dir, ".session.json"),
      JSON.stringify({ agent_id: "worker-solo", role: "implementer" }),
    );

    const fleet = generateFleetReport(dir);
    expect(fleet.capsules.length).toBe(0);
    const injected = fleet.agentRoster.find((a) => a.agentId === "worker-solo");
    expect(injected).toBeDefined();
    expect(injected?.fleetId).toBe("session");
    expect(injected?.tier).toBe(3);
    expect(injected?.status).toBe("active");
    expect(fleet.stats.totalSubagents).toBe(1);
  });

  it("does not duplicate session actor already present in capsule state", () => {
    const dir = createTempRepo("fleet-dedup");
    const capDir = join(dir, ".olt", "capsules", "run-dup");
    vfs.mkdirSync(capDir, { recursive: true });
    vfs.writeFileSync(join(capDir, "manifest.json"), JSON.stringify({ run_id: "run-dup" }));
    vfs.writeFileSync(
      join(capDir, "state.json"),
      JSON.stringify({
        agents: [
          {
            id: "agent-present",
            role: "implementer",
            status: "active",
            tier: 3,
          },
        ],
        tasks: {},
      }),
    );

    vfs.writeFileSync(
      join(dir, ".session.json"),
      JSON.stringify({ agent_id: "agent-present", role: "implementer" }),
    );

    const fleet = generateFleetReport(dir);
    const matches = fleet.agentRoster.filter((a) => a.agentId === "agent-present");
    expect(matches.length).toBe(1);
    expect(fleet.stats.totalSubagents).toBe(1);
  });

  it("reports active worktree count and list in fleet stats", () => {
    const dir = createTempRepo("fleet-worktrees");
    const wt1 = join(dir, ".olt", "worktrees", "track-a");
    const wt2 = join(dir, ".olt", "worktrees", "track-b");
    vfs.mkdirSync(wt1, { recursive: true });
    vfs.mkdirSync(wt2, { recursive: true });

    vfs.writeFileSync(
      join(wt1, ".worktree-meta.json"),
      JSON.stringify({
        trackId: "track-a",
        status: "active",
        branch: "track/track-a",
      }),
    );
    vfs.writeFileSync(
      join(wt2, ".worktree-meta.json"),
      JSON.stringify({
        trackId: "track-b",
        status: "active",
        branch: "track/track-b",
      }),
    );

    const fleet = generateFleetReport(dir);
    expect(fleet.stats.activeWorktrees).toBe(2);
    expect(fleet.stats.worktrees?.length).toBe(2);
    expect(fleet.stats.worktrees?.map((w) => w.trackId).sort()).toEqual(["track-a", "track-b"]);
  });

  it("gracefully ignores corrupted .session.json without throwing exceptions", () => {
    const dir = createTempRepo("fleet-corrupt-session");
    vfs.writeFileSync(join(dir, ".session.json"), "{ corrupt json ... invalid syntax");

    const fleet = generateFleetReport(dir);
    expect(fleet).toBeDefined();
    expect(fleet.stats.totalSubagents).toBe(0);
    expect(fleet.agentRoster.length).toBe(0);
  });

  it("synthesizes metadata for active worktree directory lacking .worktree-meta.json", () => {
    const dir = createTempRepo("fleet-synthetic-worktree");
    const untrackedDir = join(dir, ".olt", "worktrees", "untracked-feat");
    vfs.mkdirSync(untrackedDir, { recursive: true });

    const fleet = generateFleetReport(dir);
    expect(fleet.stats.activeWorktrees).toBe(1);
    expect(fleet.stats.worktrees?.length).toBe(1);
    expect(fleet.stats.worktrees?.[0]?.trackId).toBe("untracked-feat");
    expect(fleet.stats.worktrees?.[0]?.status).toBe("active");
    expect(fleet.stats.worktrees?.[0]?.branch).toBe("track/untracked-feat");
  });
});
