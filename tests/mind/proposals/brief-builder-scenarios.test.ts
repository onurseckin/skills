import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJsonBytes } from "../../../olt/scripts/src/core/json.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule/capsule.ts";
import { computeFullWakeBrief } from "../../../olt/scripts/src/mind/proposals/brief/builder.ts";

describe("Mind Proposal Brief Builder Scenarios Suite", () => {
  let tempRepo: string;
  let runRoot: string;

  beforeEach(() => {
    tempRepo = join(
      tmpdir(),
      `brief-bld-scen-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    mkdirSync(tempRepo, { recursive: true });
    runRoot = initRun(
      tempRepo,
      "mind-run-scen",
      new TextEncoder().encode("system prompt"),
      "file",
      true,
    );
    setupMatchingCharter();
  });

  afterEach(() => {
    rmSync(tempRepo, { recursive: true, force: true });
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
