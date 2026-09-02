import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJsonBytes } from "../../../../olt/scripts/src/core/json.ts";
import { initRun } from "../../../../olt/scripts/src/engine/store/capsule/capsule.ts";
import { computeFullWakeBrief } from "../../../../olt/scripts/src/mind/proposals/brief/builder.ts";

describe("Mind Proposal Brief Builder Core Suite", () => {
  let tempRepo: string;
  let runRoot: string;

  beforeEach(() => {
    tempRepo = join(
      tmpdir(),
      `brief-bld-cov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    mkdirSync(tempRepo, { recursive: true });
    runRoot = initRun(
      tempRepo,
      "mind-run-01",
      new TextEncoder().encode("system prompt"),
      "file",
      true,
    );
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

  const setupMatchingCharter = (content = "charter: valid\n") => {
    const charterDir = join(tempRepo, "olt", "agents");
    mkdirSync(charterDir, { recursive: true });
    const charterPath = join(charterDir, "mind.yaml");
    writeFileSync(charterPath, content, "utf-8");
    const sha = createHash("sha256").update(Buffer.from(content)).digest("hex");

    updateState((state) => {
      state["mind"] = {
        ...(state["mind"] as Record<string, unknown> | undefined),
        charter: {
          source_path: "olt/agents/mind.yaml",
          pinned_sha256: sha,
        },
      };
    });
    return sha;
  };

  describe("Charter Status Evaluation", () => {
    it("reports ok when charter exists and matches pinned digest", async () => {
      const sha = setupMatchingCharter("charter: valid\n");
      const brief = await computeFullWakeBrief(runRoot);

      expect(brief.facts.charterStatus).toBe("ok");
      expect(brief.facts.charterSha).toBe(sha);
      expect(brief.isHalted).toBe(false);
    });

    it("reports DRIFTED and halts when charter exists but sha mismatches pinned digest", async () => {
      setupMatchingCharter("charter: valid\n");
      writeFileSync(join(tempRepo, "olt", "agents", "mind.yaml"), "charter: drifted\n", "utf-8");

      const brief = await computeFullWakeBrief(runRoot);

      expect(brief.facts.charterStatus).toBe("DRIFTED");
      expect(brief.isHalted).toBe(true);
      expect(brief.facts.haltReason).toBe("charter drifted from pinned digest");
      expect(brief.mode).toBe("halted");
    });

    it("reports missing and halts when charter file does not exist", async () => {
      updateState((state) => {
        state["mind"] = {
          charter: { source_path: "non-existent-charter.yaml" },
        };
      });

      const brief = await computeFullWakeBrief(runRoot);

      expect(brief.facts.charterStatus).toBe("missing");
      expect(brief.isHalted).toBe(true);
      expect(brief.facts.haltReason).toBe("charter file missing");
    });
  });

  describe("Capsule Integrity Verification", () => {
    it("reports repairable/ok when capsule integrity checks pass without unrepairable errors", async () => {
      setupMatchingCharter();
      const brief = await computeFullWakeBrief(runRoot);

      expect(brief.facts.integrityStatus).toBe("repairable");
      expect(brief.facts.integrityIssuesCount).toBe(0);
    });

    it("reports FAILED and halts when event chain integrity is corrupt", async () => {
      setupMatchingCharter();
      writeFileSync(join(runRoot, "events.jsonl"), "corrupt event line\n", "utf-8");

      const brief = await computeFullWakeBrief(runRoot);

      expect(brief.facts.integrityStatus).toBe("FAILED");
      expect(brief.isHalted).toBe(true);
      expect(brief.facts.haltReason).toBe("mind capsule integrity failed");
    });
  });

  describe("Budget & Quota Throttling", () => {
    it("marks budgetDeferred false when within pulse and wall clock limits", async () => {
      setupMatchingCharter();
      updateState((state) => {
        state["budget"] = {
          pulses_today: 10,
          pulses_per_day: 96,
          wall_clock_ms_today: 100_000,
          wall_clock_ms_per_day: 21_600_000,
        };
      });

      const brief = await computeFullWakeBrief(runRoot);

      expect(brief.facts.budgetDeferred).toBe(false);
      expect(brief.facts.pulsesToday).toBe(10);
      expect(brief.facts.pulsesPerDay).toBe(96);
    });

    it("marks budgetDeferred true when pulses_today exceeds pulses_per_day", async () => {
      setupMatchingCharter();
      updateState((state) => {
        state["budget"] = {
          pulses_today: 96,
          pulses_per_day: 96,
        };
      });

      const brief = await computeFullWakeBrief(runRoot);

      expect(brief.facts.budgetDeferred).toBe(true);
      expect(brief.mode).toBe("paused");
    });

    it("marks budgetDeferred true when wall clock limit is exceeded", async () => {
      setupMatchingCharter();
      updateState((state) => {
        state["budget"] = {
          pulses_today: 1,
          pulses_per_day: 96,
          wall_clock_ms_today: 22_000_000,
          wall_clock_ms_per_day: 21_600_000,
        };
      });

      const brief = await computeFullWakeBrief(runRoot);

      expect(brief.facts.budgetDeferred).toBe(true);
      expect(brief.mode).toBe("paused");
    });
  });
});
