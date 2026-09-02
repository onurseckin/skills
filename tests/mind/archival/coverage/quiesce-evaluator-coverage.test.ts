import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildQuiescentDigest,
  calculateQuiescentInterval,
  computeQuiescentStreak,
  executeQuiesceLane,
  formatQuiescentDigestMarkdown,
  shouldTriggerQuiescentDigest,
} from "../../../../olt/scripts/src/mind/archival/quiesce/evaluator.ts";
import { MIND_DISCOVERY_SOURCES } from "../../../../olt/scripts/src/mind/memory/sources/index.ts";
import type { QuiescentSourceObservation } from "../../../../olt/scripts/src/mind/archival/quiesce/types.ts";

describe("Quiesce Evaluator Coverage Suite", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "quiesce-cov-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("computes quiescent streaks across valid and invalid inputs", () => {
    expect(computeQuiescentStreak(undefined)).toBe(1);
    expect(computeQuiescentStreak(null)).toBe(1);
    expect(computeQuiescentStreak(-1)).toBe(1);
    expect(computeQuiescentStreak(Number.NaN)).toBe(1);
    expect(computeQuiescentStreak(Number.POSITIVE_INFINITY)).toBe(1);
    expect(computeQuiescentStreak(0)).toBe(1);
    expect(computeQuiescentStreak(4)).toBe(5);
    expect(computeQuiescentStreak(3.8)).toBe(4);
  });

  it("calculates exponential backoff intervals with bounded defaults", () => {
    const base = calculateQuiescentInterval(0, 0, 0);
    expect(base).toBeGreaterThanOrEqual(1000);

    const higherStreak = calculateQuiescentInterval(2000, 10000, 5);
    expect(higherStreak).toBeLessThanOrEqual(10000);
    expect(higherStreak).toBeGreaterThan(2000);
  });

  it("evaluates digest trigger thresholds", () => {
    expect(shouldTriggerQuiescentDigest(8)).toBe(true);
    expect(shouldTriggerQuiescentDigest(7)).toBe(false);
    expect(shouldTriggerQuiescentDigest(3, 3)).toBe(true);
    expect(shouldTriggerQuiescentDigest(4, 3)).toBe(false);
  });

  it("formats and builds quiescent digest markdown", () => {
    const sampleObservations: QuiescentSourceObservation[] = [
      {
        source: "capsule-integrity",
        commandId: "cmd-capsule",
        count: 0,
        evidenceClass: "empirical",
        sourceNumber: 1,
        sourceName: "Capsule Integrity",
      },
    ];

    const markdown = formatQuiescentDigestMarkdown({
      streak: 8,
      runId: "run-test-1",
      generatedAt: "2026-09-01T00:00:00Z",
      sources: sampleObservations,
    });
    expect(markdown).toContain("Quiescent Repository Digest (Streak 8)");
    expect(markdown).toContain("run-test-1");
    expect(markdown).toContain("Capsule Integrity");

    const digest = buildQuiescentDigest({
      streak: 8,
      sources: sampleObservations,
      runId: "custom-run",
      generatedAt: "2026-09-01T12:00:00Z",
    });
    expect(digest.runId).toBe("custom-run");
    expect(digest.generatedAt).toBe("2026-09-01T12:00:00Z");
    expect(digest.sourcesChecked.length).toBe(1);

    const defaultDigest = buildQuiescentDigest({
      streak: 1,
      sources: sampleObservations,
    });
    expect(defaultDigest.runId).toBe("mind");
    expect(defaultDigest.generatedAt).toBeDefined();
  });

  it("executes quiesce lane when validation fails", async () => {
    const result = await executeQuiesceLane({
      sources: ["invalid-spec"],
      previousStreak: 4,
      writeReport: false,
    });
    expect(result.ok).toBe(false);
    expect(result.streak).toBe(0);
    expect(result.digest).toBeUndefined();
    expect(result.markdown).toContain("Quiescent Lane Execution Failed");
  });

  it("executes quiesce lane when all 10 sources are validated with command evidence", async () => {
    const runRoot = join(tempDir, "capsules", "run-quiesce-test");
    mkdirSync(join(runRoot, "commands"), { recursive: true });

    const sourcesInput: string[] = [];
    for (const def of MIND_DISCOVERY_SOURCES) {
      const commandId = `cmd-${def.id}`;
      writeFileSync(join(runRoot, "commands", `${commandId}.json`), JSON.stringify({ ok: true }));
      sourcesInput.push(`${def.id}:${commandId}:0`);
    }

    const result = await executeQuiesceLane({
      runRoot,
      sources: sourcesInput,
      previousStreak: 3,
      writeReport: true,
      now: new Date("2026-09-01T00:00:00Z"),
    });

    expect(result.ok).toBe(true);
    expect(result.streak).toBe(4);
    expect(result.digest).toBeDefined();
    expect(result.reportPath).toBe(join(runRoot, "reports", "quiescent-digest.md"));
    expect(existsSync(result.reportPath!)).toBe(true);

    const reportContent = readFileSync(result.reportPath!, "utf-8");
    expect(reportContent).toContain("Streak 4");
    expect(reportContent).toContain("run-quiesce-test");
  });
});
