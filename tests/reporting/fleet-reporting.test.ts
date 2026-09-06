import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findLatestCapsuleIn } from "../../olt/scripts/src/cli/commands/dag-view.ts";
import { reportUnifiedCommand } from "../../olt/scripts/src/cli/commands/unified-reporting.ts";
import {
  discoverActiveCapsules,
  generateFleetReport,
} from "../../olt/scripts/src/reporting/unified/fleet-builder.ts";
import { formatFleetDashboard } from "../../olt/scripts/src/reporting/unified/fleet-renderer.ts";

function createMockRepo(): { repoDir: string; cleanup: () => void } {
  const testId = `fleet-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const repoDir = join(tmpdir(), testId);
  const capsulesDir = join(repoDir, ".olt", "capsules");

  mkdirSync(capsulesDir, { recursive: true });

  // 1. Active capsule 1: dag-engine
  const cap1 = join(capsulesDir, "dag-engine");
  mkdirSync(cap1, { recursive: true });
  writeFileSync(
    join(cap1, "manifest.json"),
    JSON.stringify({ run_id: "dag-engine", title: "DAG Engine Fleet" }),
  );
  writeFileSync(
    join(cap1, "state.json"),
    JSON.stringify({
      agents: [
        { id: "mind-gen-6", role: "mind", status: "active", tier: 0 },
        { id: "mind_auditor", role: "mind-auditor", status: "active", tier: 1 },
        { id: "skill_auditor", role: "skill-auditor", status: "active", tier: 1 },
        { id: "orch-dag", role: "orchestrator", status: "active", tier: 1 },
        { id: "coord-dag", role: "coordinator", status: "active", tier: 2 },
      ],
      tasks: {
        "task-1": {
          id: "task-1",
          label: "Build Engine",
          status: "leased",
          priority: 50,
          dependencies: [],
          write_scope: ["src/engine"],
          lease: { agent_id: "imp-1", role: "implementer", attempt: 1 },
        },
        "task-2": {
          id: "task-2",
          label: "Validate Engine",
          status: "validating",
          priority: 50,
          dependencies: ["task-1"],
          write_scope: ["src/engine"],
          validations: [{ validator_id: "val-1", domain: "tests" }],
        },
      },
    }),
  );

  // 2. Active capsule 2: tooling-fleet
  const cap2 = join(capsulesDir, "tooling-fleet");
  mkdirSync(cap2, { recursive: true });
  writeFileSync(
    join(cap2, "manifest.json"),
    JSON.stringify({ run_id: "tooling-fleet", title: "Tooling Fleet" }),
  );
  writeFileSync(
    join(cap2, "state.json"),
    JSON.stringify({
      agents: [
        { id: "orch-tooling", role: "orchestrator", status: "active", tier: 1 },
        { id: "coord-tooling", role: "coordinator", status: "active", tier: 2 },
      ],
      tasks: {
        "task-3": {
          id: "task-3",
          label: "CLI Refactor",
          status: "ready",
          priority: 50,
          dependencies: [],
          write_scope: ["src/cli"],
        },
        "task-4": {
          id: "task-4",
          label: "Done Task",
          status: "done",
          priority: 50,
          dependencies: [],
          write_scope: ["src/cli"],
        },
      },
    }),
  );

  // 3. Ignored directory: archive
  const archiveDir = join(capsulesDir, "archive");
  mkdirSync(join(archiveDir, "old-run"), { recursive: true });
  writeFileSync(join(archiveDir, "old-run", "state.json"), JSON.stringify({ tasks: {} }));

  // 4. Ignored directory: .locks
  const locksDir = join(capsulesDir, ".locks");
  mkdirSync(locksDir, { recursive: true });
  writeFileSync(join(locksDir, "lockfile"), "locked");

  // 5. Ignored directory: invalid (no state or manifest)
  const invalidDir = join(capsulesDir, "stale-scratch");
  mkdirSync(invalidDir, { recursive: true });

  return {
    repoDir,
    cleanup: () => {
      try {
        rmSync(repoDir, { recursive: true, force: true });
      } catch {}
    },
  };
}

describe("Global Fleet Reporting & Safe Capsule Enumeration", () => {
  it("safe capsule enumeration ignores archive, .locks, and invalid directories", () => {
    const { repoDir, cleanup } = createMockRepo();
    try {
      const active = discoverActiveCapsules(repoDir);
      expect(active.length).toBe(2);
      expect(active.some((p) => p.includes("dag-engine"))).toBe(true);
      expect(active.some((p) => p.includes("tooling-fleet"))).toBe(true);
      expect(active.some((p) => p.includes("archive"))).toBe(false);
      expect(active.some((p) => p.includes(".locks"))).toBe(false);
      expect(active.some((p) => p.includes("stale-scratch"))).toBe(false);

      const latest = findLatestCapsuleIn(repoDir);
      expect(latest).not.toBeNull();
      expect(latest?.includes("archive")).toBe(false);
      expect(latest?.includes(".locks")).toBe(false);
      expect(latest?.includes("stale-scratch")).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("fleet builder aggregates multi-capsule data correctly", () => {
    const { repoDir, cleanup } = createMockRepo();
    try {
      const fleet = generateFleetReport(repoDir);
      expect(fleet.stats.activeFleets).toBe(2);
      expect(fleet.stats.globalTasks).toBe(4);
      expect(fleet.stats.totalWaves).toBeGreaterThanOrEqual(2);
      expect(fleet.stats.occupancy.coding).toBe(1);
      expect(fleet.stats.occupancy.validating).toBe(1);
      expect(fleet.stats.occupancy.standby).toBe(1);
      expect(fleet.stats.occupancy.satisfied).toBe(1);

      expect(fleet.stats.supervisoryHealth.mind).toBe("Active");
      expect(fleet.stats.supervisoryHealth.mindAuditor).toBe("Active");
      expect(fleet.stats.supervisoryHealth.skillAuditor).toBe("1/1");
      expect(fleet.stats.supervisoryHealth.healthy).toBe(true);

      expect(fleet.agentRoster.length).toBeGreaterThanOrEqual(7);
      expect(fleet.agentRoster[0]?.tier).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("fleet renderer renders Sugiyama boxes, tables, and dashboard sections", () => {
    const { repoDir, cleanup } = createMockRepo();
    try {
      const fleet = generateFleetReport(repoDir);
      const dashboard = formatFleetDashboard(fleet);

      expect(dashboard).toContain("GLOBAL FLEET SNAPSHOT DASHBOARD");
      expect(dashboard).toContain("### Section 1: Whole-Repository Multi-Tier Agent Roster");
      expect(dashboard).toContain("### Section 2: Global Fleet Concurrency & Phase Rollup");
      expect(dashboard).toContain("### Section 3: Multi-Capsule Sugiyama Hierarchical DAG");
      expect(dashboard).toContain("### Section 4: Supervisory Health Rollup");

      // Sugiyama rounded box chars & coordinates
      expect(dashboard).toContain("╭");
      expect(dashboard).toContain("╰");
      expect(dashboard).toContain("[W1:L");
      expect(dashboard).toContain("dag-engine");
      expect(dashboard).toContain("tooling-fleet");
    } finally {
      cleanup();
    }
  });

  it("reportUnifiedCommand invokes fleet report when --run is omitted", () => {
    const { repoDir, cleanup } = createMockRepo();
    try {
      const res = reportUnifiedCommand({ repo: repoDir });
      expect(res.stats).toBeDefined();
      expect(res.capsules).toBeDefined();
      expect(typeof res.markdown).toBe("string");
      expect(res.markdown as string).toContain("GLOBAL FLEET SNAPSHOT DASHBOARD");

      // When run is explicitly specified, uses single-capsule mode
      const validCapsule = resolve(
        process.cwd(),
        "../../../.olt/capsules/archive/dag-engine-and-reporting-separation",
      );
      if (existsSync(validCapsule)) {
        const singleRes = reportUnifiedCommand({
          run: validCapsule,
        });
        expect(singleRes.topology).toBeDefined();
        expect(singleRes.stats).toBeUndefined();
      }
    } finally {
      cleanup();
    }
  });
});
