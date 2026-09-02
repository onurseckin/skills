import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  enforceInfiniteMindCadence,
  inspectRecycleHealth,
  validateRolloverReadiness,
} from "../../../olt/scripts/src/mind/archival/recycler/reporter.ts";

describe("Mind Archival Recycler Reporter (reporter.ts)", () => {
  let tempDir: string;
  let feedbackFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mind-reporter-test-"));
    feedbackFile = join(tempDir, "FEEDBACK_QUEUE.jsonl");
    writeFileSync(feedbackFile, "");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const writeFeedbackLine = (id: string, status: string = "PENDING") => {
    const item = {
      id,
      title: `Feedback ${id}`,
      content: `Content for ${id}`,
      priority: "CRITICAL_USER_FEEDBACK",
      category: "CORE_ENGINE",
      status,
      timestamp: new Date().toISOString(),
    };
    writeFileSync(feedbackFile, JSON.stringify(item) + "\n", { flag: "a" });
  };

  describe("enforceInfiniteMindCadence", () => {
    it("returns active infinite cadence instruction when isTerminal is falsy", () => {
      const res = enforceInfiniteMindCadence({
        runRoot: "/path/to/capsule",
        actor: "governor-1",
      });

      expect(res.cadence).toBe("infinite_autonomous");
      expect(res.allowed).toBe(true);
      expect(res.nextInstruction).toBe("bun harness.ts mind:wake --run /path/to/capsule");
      expect(res.message).toContain("Infinite autonomous mind cadence active");
    });

    it("returns terminal restart message when isTerminal is true", () => {
      const res = enforceInfiniteMindCadence({
        runRoot: "/path/to/capsule",
        actor: "governor-1",
        isTerminal: true,
        nextWakeAt: new Date().toISOString(),
      });

      expect(res.cadence).toBe("infinite_autonomous");
      expect(res.allowed).toBe(true);
      expect(res.nextInstruction).toBe("bun harness.ts mind:wake --run /path/to/capsule");
      expect(res.message).toContain("Terminal outcome recorded; perpetual mind loop remains armed");
    });
  });

  describe("inspectRecycleHealth", () => {
    it("evaluates healthy state for quiescent empty state", () => {
      const health = inspectRecycleHealth({}, "/test/run");
      expect(health.healthy).toBe(true);
      expect(health.activeCadence).toBe("infinite_autonomous");
      expect(health.assessment.canRecycle).toBe(true);
      expect(health.assessment.infiniteCadence).toBe(true);
      expect(typeof health.timestamp).toBe("string");
    });

    it("honors custom now timestamp option", () => {
      const customTime = "2026-05-10T12:00:00.000Z";
      const health = inspectRecycleHealth({}, "/test/run", { now: customTime });
      expect(health.timestamp).toBe(customTime);
    });
  });

  describe("validateRolloverReadiness", () => {
    it("returns not ready when mind substate is missing or non-object", () => {
      const resNull = validateRolloverReadiness({});
      expect(resNull.ready).toBe(false);
      expect(resNull.reason).toContain("Missing mind substate in source capsule");
      expect(resNull.generation).toBe(1);
      expect(resNull.targetGeneration).toBe(2);

      const resStr = validateRolloverReadiness({ mind: "invalid" as unknown as object }, 4);
      expect(resStr.ready).toBe(false);
      expect(resStr.targetGeneration).toBe(4);
    });

    it("returns not ready when target generation <= current generation", () => {
      const state = { mind: { generation: 3 } };
      const resLower = validateRolloverReadiness(state, 2);
      expect(resLower.ready).toBe(false);
      expect(resLower.reason).toContain("Target generation 2 must exceed current generation 3");
      expect(resLower.generation).toBe(3);
      expect(resLower.targetGeneration).toBe(2);

      const resEqual = validateRolloverReadiness(state, 3);
      expect(resEqual.ready).toBe(false);
      expect(resEqual.reason).toContain("Target generation 3 must exceed current generation 3");
    });

    it("returns not ready when source capsule is already rotated", () => {
      const state = { mind: { generation: 2, status: "rotated" } };
      const res = validateRolloverReadiness(state, 3);
      expect(res.ready).toBe(false);
      expect(res.reason).toBe("Source capsule is already rotated (sealed)");
      expect(res.generation).toBe(2);
      expect(res.targetGeneration).toBe(3);
    });

    it("evaluates readiness with active candidate counts and pending feedback counts", () => {
      writeFeedbackLine("fb-pending-1", "PENDING");
      writeFeedbackLine("fb-pending-2", "PENDING");
      writeFeedbackLine("fb-done-3", "PROCESSED");

      const state = {
        mind: {
          generation: 2,
          status: "active",
          candidates: [
            { id: "cand-1", status: "opened" },
            { id: "cand-2", status: "open" },
            { id: "cand-3", status: "admitted" },
            { id: "cand-4", status: "rejected" },
            { id: "cand-5", status: "closed" },
          ],
        },
      };

      const res = validateRolloverReadiness(state, undefined, {
        feedbackQueuePath: feedbackFile,
      });

      expect(res.ready).toBe(true);
      expect(res.reason).toContain("Mind is ready to transition from generation 2 to 3");
      expect(res.generation).toBe(2);
      expect(res.targetGeneration).toBe(3);
      expect(res.pendingFeedbackCount).toBe(2);
      expect(res.activeCandidatesCount).toBe(3);
    });

    it("defaults generation to 1 when mind.generation is missing", () => {
      const state = {
        mind: {
          status: "active",
        },
      };

      const res = validateRolloverReadiness(state, undefined, {
        feedbackQueuePath: feedbackFile,
      });

      expect(res.ready).toBe(true);
      expect(res.generation).toBe(1);
      expect(res.targetGeneration).toBe(2);
      expect(res.pendingFeedbackCount).toBe(0);
      expect(res.activeCandidatesCount).toBe(0);
    });
  });
});
