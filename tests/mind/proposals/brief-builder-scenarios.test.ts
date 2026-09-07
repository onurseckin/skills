import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJsonBytes } from "../../../olt/scripts/src/core/json.ts";
import { computeFullWakeBrief } from "../../../olt/scripts/src/mind/proposals/brief/builder.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { initVirtualCapsule } from "./proposals-fixture.ts";

mock.module("../../../olt/scripts/src/installer/source-validation.ts", () => ({
  validateSkillSource: async (source: string) => ({
    root: source,
    digest: "mock-tree-digest-sha256",
    runtimeVersion: "1.4.0",
  }),
}));

mock.module("../../../olt/scripts/src/installer/runtime-freshness.ts", () => ({
  installedRuntimeFreshness: async () => ({
    drifted: false,
    installedRuntimeVersion: "1.4.0",
    referenceRuntimeVersion: "1.4.0",
  }),
}));

describe("Mind Proposal Brief Builder Scenarios Suite", () => {
  let session: VirtualFSSession;
  let vfs: VirtualMemoryFS;
  let tempRepo: string;
  let runRoot: string;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync("/virtual/tmp", { recursive: true });
    session = createVirtualFSSession(vfs);

    tempRepo = `/virtual/brief-bld-scen-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    runRoot = initVirtualCapsule(vfs, tempRepo, "mind-run-scen");
    setupMatchingCharter();
  });

  afterEach(() => {
    session.cleanup();
  });

  const updateState = (updater: (state: Record<string, unknown>) => void) => {
    const statePath = join(runRoot, "state.json");
    const current = JSON.parse(readFileSync(statePath, "utf-8")) as Record<string, unknown>;
    updater(current);
    writeFileSync(statePath, canonicalJsonBytes(current));
  };

  const setupMatchingCharter = () => {
    const content = "charter: active\n";
    const charterDir = join(tempRepo, "olt", "agents");
    mkdirSync(charterDir, { recursive: true });
    const charterPath = join(charterDir, "mind.yaml");
    writeFileSync(charterPath, content, "utf-8");
    const sha = createHash("sha256").update(Buffer.from(content)).digest("hex");

    updateState((state) => {
      state["mind"] = {
        charter: { source_path: "olt/agents/mind.yaml", pinned_sha256: sha },
      };
    });
  };

  describe("GAP & Driver Lateness Calculation", () => {
    it("computes gapMs and driverLatenessMs when lastPulse closed_at is finite", async () => {
      const closedTime = new Date("2026-09-01T20:00:00.000Z").toISOString();
      const nowMs = Date.parse("2026-09-01T20:15:00.000Z");

      updateState((state) => {
        state["pulse"] = {
          last: {
            closed_at: closedTime,
            armed_interval_ms: 600_000,
          },
        };
      });

      const brief = await computeFullWakeBrief(runRoot, { now: nowMs });

      expect(brief.facts.gapMs).toBe(900_000);
      expect(brief.facts.driverLatenessMs).toBe(300_000);
      expect(brief.facts.driverLateWarning).toBe(false);
    });

    it("triggers driverLateWarning when gapMs exceeds 3x armedIntervalMs", async () => {
      const closedTime = new Date("2026-09-01T18:00:00.000Z").toISOString();
      const nowMs = Date.parse("2026-09-01T22:00:00.000Z");

      updateState((state) => {
        state["pulse"] = {
          last: {
            closed_at: closedTime,
            armed_interval_ms: 3_600_000,
          },
        };
      });

      const brief = await computeFullWakeBrief(runRoot, { now: nowMs });

      expect(brief.facts.gapMs).toBe(14_400_000);
      expect(brief.facts.driverLateWarning).toBe(true);
    });

    it("handles degenerate pulse timestamps and zero intervals gracefully without NaN", async () => {
      // 1. null / unparseable closed_at
      updateState((state) => {
        state["pulse"] = {
          last: {
            closed_at: "not-a-valid-timestamp",
            armed_interval_ms: 600_000,
          },
        };
      });

      const briefInvalidDate = await computeFullWakeBrief(runRoot);
      expect(briefInvalidDate.facts.gapMs).toBeNull();
      expect(briefInvalidDate.facts.driverLatenessMs).toBeNull();
      expect(briefInvalidDate.facts.driverLateWarning).toBe(false);

      // 2. zero or negative armed_interval_ms
      const closedTime = new Date("2026-09-01T20:00:00.000Z").toISOString();
      const nowMs = Date.parse("2026-09-01T20:10:00.000Z");

      updateState((state) => {
        state["pulse"] = {
          last: {
            closed_at: closedTime,
            armed_interval_ms: 0,
          },
        };
      });

      const briefZeroInterval = await computeFullWakeBrief(runRoot, { now: nowMs });
      expect(briefZeroInterval.facts.gapMs).toBe(600_000);
      expect(briefZeroInterval.facts.driverLatenessMs).toBe(600_000);
      expect(briefZeroInterval.facts.driverLateWarning).toBe(true);
      expect(Number.isNaN(briefZeroInterval.facts.driverLatenessMs)).toBe(false);
    });
  });

  describe("Attention, Health Observations & Escalations", () => {
    it("aggregates unresolved escalations and cataloged health observations", async () => {
      const nowMs = Date.parse("2026-09-01T20:30:00.000Z");
      const obsTime = new Date("2026-09-01T20:20:00.000Z").toISOString();

      updateState((state) => {
        state["escalations"] = [
          { id: "esc-1", resolved_at: null },
          { id: "esc-2", resolved_at: "2026-09-01T19:00:00.000Z" },
          { id: "esc-3", resolved_at: null },
        ];
        state["observations"] = [
          { source: "intent-drift", count: 4, observed_at: obsTime },
          { source: "unused-code", count: 2, observed_at: obsTime },
        ];
      });

      const brief = await computeFullWakeBrief(runRoot, { now: nowMs });

      expect(brief.facts.escalationsCount).toBe(2);
      expect(brief.facts.healthObservations.length).toBe(2);
      expect(brief.facts.healthObservations[0]?.source).toBe("intent-drift");
      expect(brief.facts.healthObservations[0]?.count).toBe(4);
      expect(brief.facts.healthAgeMs).toBe(600_000);
    });
  });

  describe("Consecutive Crashes & Explicit Halted States", () => {
    it("halts when consecutive pulse crashes threshold (3) is exceeded", async () => {
      updateState((state) => {
        state["pulse"] = {
          last: {
            outcome: "crashed",
            consecutive_crashes: 3,
          },
        };
      });

      const brief = await computeFullWakeBrief(runRoot);

      expect(brief.isHalted).toBe(true);
      expect(brief.facts.haltReason).toBe("consecutive pulse crashes threshold exceeded");
      expect(brief.mode).toBe("halted");
    });

    it("halts when mindState.halted flag is explicitly true", async () => {
      updateState((state) => {
        state["mind"] = {
          ...(state["mind"] as Record<string, unknown> | undefined),
          halted: true,
          halt_reason: "Manual safety override",
        };
      });

      const brief = await computeFullWakeBrief(runRoot);

      expect(brief.isHalted).toBe(true);
      expect(brief.facts.haltReason).toBe("Manual safety override");
    });

    it("evaluates runtime freshness when home is provided", async () => {
      const brief = await computeFullWakeBrief(runRoot, {
        home: tempRepo,
      });

      expect(typeof brief.facts.runtimeStatus).toBe("string");
      expect(["ok", "drifted", "unknown"]).toContain(brief.facts.runtimeStatus);
    });

    it("respects actor and options passed into computeFullWakeBrief", async () => {
      const brief = await computeFullWakeBrief(runRoot, {
        actor: "custom-orchestrator",
        driver: "cron",
        host: "antigravity",
      });

      expect(brief.actor).toBe("custom-orchestrator");
      expect(brief.facts.actor).toBe("custom-orchestrator");
    });
  });
});
