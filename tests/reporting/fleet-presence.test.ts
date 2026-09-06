import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateFleetReport } from "../../olt/scripts/src/reporting/unified/fleet-builder.ts";

function createTempRepo(prefix: string): { dir: string; cleanup: () => void } {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  mkdirSync(join(dir, ".git"), { recursive: true });
  mkdirSync(join(dir, ".olt", "worktrees"), { recursive: true });
  mkdirSync(join(dir, ".olt", "capsules"), { recursive: true });
  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    },
  };
}

describe("Fleet Reporting - Self-Presence & Worktree Rollup", () => {
  it("injects calling agent from .session.json into agentRoster when not in capsule state", () => {
    const { dir, cleanup } = createTempRepo("fleet-presence");
    try {
      const capDir = join(dir, ".olt", "capsules", "run-core");
      mkdirSync(capDir, { recursive: true });
      writeFileSync(
        join(capDir, "manifest.json"),
        JSON.stringify({ run_id: "run-core", title: "Core Run" }),
      );
      writeFileSync(
        join(capDir, "state.json"),
        JSON.stringify({
          agents: [{ id: "orch-1", role: "orchestrator", status: "active", tier: 1 }],
          tasks: {},
        }),
      );

      writeFileSync(
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
    } finally {
      cleanup();
    }
  });

  it("binds calling agent to 'session' when no active capsules exist", () => {
    const { dir, cleanup } = createTempRepo("fleet-session-only");
    try {
      writeFileSync(
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
    } finally {
      cleanup();
    }
  });

  it("does not duplicate session actor already present in capsule state", () => {
    const { dir, cleanup } = createTempRepo("fleet-dedup");
    try {
      const capDir = join(dir, ".olt", "capsules", "run-dup");
      mkdirSync(capDir, { recursive: true });
      writeFileSync(join(capDir, "manifest.json"), JSON.stringify({ run_id: "run-dup" }));
      writeFileSync(
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

      writeFileSync(
        join(dir, ".session.json"),
        JSON.stringify({ agent_id: "agent-present", role: "implementer" }),
      );

      const fleet = generateFleetReport(dir);
      const matches = fleet.agentRoster.filter((a) => a.agentId === "agent-present");
      expect(matches.length).toBe(1);
      expect(fleet.stats.totalSubagents).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("reports active worktree count and list in fleet stats", () => {
    const { dir, cleanup } = createTempRepo("fleet-worktrees");
    try {
      const wt1 = join(dir, ".olt", "worktrees", "track-a");
      const wt2 = join(dir, ".olt", "worktrees", "track-b");
      mkdirSync(wt1, { recursive: true });
      mkdirSync(wt2, { recursive: true });

      writeFileSync(
        join(wt1, ".worktree-meta.json"),
        JSON.stringify({
          trackId: "track-a",
          status: "active",
          branch: "track/track-a",
        }),
      );
      writeFileSync(
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
    } finally {
      cleanup();
    }
  });
});
