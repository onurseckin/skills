import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  buildQuiescentDigest,
  calculateQuiescentInterval,
  computeQuiescentStreak,
  DEFAULT_BASE_INTERVAL_MS,
  DEFAULT_MAX_INTERVAL_MS,
  executeQuiesceLane,
  formatQuiescentDigestMarkdown,
  parseQuiescentSourceSpec,
  QUIESCENT_DIGEST_STREAK_THRESHOLD,
  shouldTriggerQuiescentDigest,
  tryParseQuiescentSourceSpec,
  validateQuiescentScan,
  type QuiescentSourceObservation,
} from "../../../../olt/scripts/src/mind/archival/quiesce/index.ts";
import { cleanupVirtualMindFS, setupVirtualMindFS } from "../../fixtures/index.ts";

describe("Mind Assembly Cadence Quiesce Suite", () => {
  beforeEach(() => {
    setupVirtualMindFS();
  });
  afterEach(() => {
    cleanupVirtualMindFS();
  });

  describe("Source Specification Parsing and Robustness", () => {
    it("parses valid source specifications with standard format", () => {
      const parsed = parseQuiescentSourceSpec("intent-drift:cmd-001:0");
      expect(parsed.source).toBe("intent-drift");
      expect(parsed.commandId).toBe("cmd-001");
      expect(parsed.count).toBe(0);
    });

    it("parses specifications when command ID contains embedded colons", () => {
      const parsed = parseQuiescentSourceSpec("unused-code:cmd:nested:sub:0");
      expect(parsed.source).toBe("unused-code");
      expect(parsed.commandId).toBe("cmd:nested:sub");
      expect(parsed.count).toBe(0);
    });

    it("throws HarnessError on negative count in specification", () => {
      expect(() => parseQuiescentSourceSpec("intent-drift:cmd-1:-5")).toThrow(HarnessError);
    });

    it("throws HarnessError on non-numeric count or missing parts", () => {
      expect(() => parseQuiescentSourceSpec("intent-drift:cmd-1:notanumber")).toThrow(HarnessError);
      expect(() => parseQuiescentSourceSpec("only-one-part")).toThrow(HarnessError);
      expect(() => parseQuiescentSourceSpec(":cmd-1:0")).toThrow(HarnessError);
      expect(() => parseQuiescentSourceSpec("   ")).toThrow(HarnessError);
    });

    it("tryParseQuiescentSourceSpec safely returns result without throwing", () => {
      const success = tryParseQuiescentSourceSpec("literal-fallbacks:cmd-2:0");
      expect(success.ok).toBe(true);
      if (success.ok) {
        expect(success.value.source).toBe("literal-fallbacks");
      }
      const failure = tryParseQuiescentSourceSpec("invalid-spec");
      expect(failure.ok).toBe(false);
      if (!failure.ok) {
        expect(failure.error).toBeDefined();
      }
    });
  });

  describe("Quiescent Scan Validation and Evidence Verification", () => {
    const canonicalSources = [
      "intent-drift:cmd-1:0",
      "unused-code:cmd-2:0",
      "literal-fallbacks:cmd-3:0",
      "open-findings:cmd-4:0",
      "escalated-tasks:cmd-5:0",
      "failing-gates:cmd-6:0",
      "capsule-integrity:cmd-7:0",
      "install-drift:cmd-8:0",
      "unsealed-capsules:cmd-9:0",
      "charter-backlog:cmd-10:0",
    ];

    it("detects missing discovery sources when scan is incomplete", () => {
      const partial = ["intent-drift:cmd-1:0", "unused-code:cmd-2:0"];
      const result = validateQuiescentScan(partial);
      expect(result.ok).toBe(false);
      expect(result.missingSources.length).toBe(8);
      expect(result.error).toContain("missing 8 source(s)");
    });

    it("detects non-zero count violations across observed sources", () => {
      const dirty = [
        "intent-drift:cmd-1:2",
        "unused-code:cmd-2:0",
        "literal-fallbacks:cmd-3:0",
        "open-findings:cmd-4:1",
        "escalated-tasks:cmd-5:0",
        "failing-gates:cmd-6:0",
        "capsule-integrity:cmd-7:0",
        "install-drift:cmd-8:0",
        "unsealed-capsules:cmd-9:0",
        "charter-backlog:cmd-10:0",
      ];
      const result = validateQuiescentScan(dirty);
      expect(result.ok).toBe(false);
      expect(result.nonZeroSources.length).toBe(2);
      expect(result.error).toContain("non-zero counts detected");
    });

    it("flags unevidenced sources when command records are absent from disk", () => {
      const result = validateQuiescentScan(canonicalSources);
      expect(result.ok).toBe(false);
      expect(result.unevidencedSources.length).toBe(10);
      expect(result.error).toContain("unrecorded command evidence");
    });

    it("validates cleanly when all 10 sources are zero and command records exist", () => {
      const vfs = setupVirtualMindFS();
      const capDir = "/capsules/run-quiesce-test";
      for (let i = 1; i <= 10; i++) {
        vfs.mkdirSync(`${capDir}/commands/cmd-${i}`, { recursive: true });
        vfs.writeFileSync(`${capDir}/commands/cmd-${i}/record.json`, JSON.stringify({ ok: true }));
      }
      const result = validateQuiescentScan(canonicalSources, { runRoot: capDir });
      expect(result.ok).toBe(true);
      expect(result.observations.length).toBe(10);
      expect(result.missingSources.length).toBe(0);
      expect(result.nonZeroSources.length).toBe(0);
      expect(result.invalidSources.length).toBe(0);
      expect(result.unevidencedSources.length).toBe(0);
    });
  });

  describe("Streak Computation and Interval Exponential Backoff", () => {
    it("increments quiescent streak cleanly on valid non-negative inputs", () => {
      expect(computeQuiescentStreak(0)).toBe(1);
      expect(computeQuiescentStreak(5)).toBe(6);
      expect(computeQuiescentStreak(4.8)).toBe(5);
    });

    it("defaults streak to 1 on invalid, null, negative, or undefined inputs", () => {
      expect(computeQuiescentStreak(null)).toBe(1);
      expect(computeQuiescentStreak(undefined)).toBe(1);
      expect(computeQuiescentStreak(-3)).toBe(1);
      expect(computeQuiescentStreak(NaN)).toBe(1);
    });

    it("calculates exponential backoff intervals clamped between base and max", () => {
      const base = 60_000;
      const max = 3_600_000;
      expect(calculateQuiescentInterval(base, max, 0)).toBe(60_000);
      expect(calculateQuiescentInterval(base, max, 1)).toBe(90_000);
      expect(calculateQuiescentInterval(base, max, 2)).toBe(135_000);
      expect(calculateQuiescentInterval(base, max, 15)).toBe(max);
      expect(calculateQuiescentInterval(1000, 5000, 0)).toBe(1000);
    });

    it("evaluates shouldTriggerQuiescentDigest strictly at threshold boundary", () => {
      expect(shouldTriggerQuiescentDigest(QUIESCENT_DIGEST_STREAK_THRESHOLD)).toBe(true);
      expect(shouldTriggerQuiescentDigest(QUIESCENT_DIGEST_STREAK_THRESHOLD - 1)).toBe(false);
      expect(shouldTriggerQuiescentDigest(QUIESCENT_DIGEST_STREAK_THRESHOLD + 1)).toBe(false);
      expect(shouldTriggerQuiescentDigest(0)).toBe(false);
    });
  });

  describe("Digest Formatting and Quiesce Lane Execution", () => {
    const mockObservations: QuiescentSourceObservation[] = [
      {
        source: "intent-drift",
        commandId: "cmd-1",
        count: 0,
        evidenceClass: "empirical",
        sourceNumber: 1,
        sourceName: "code intent alignment",
      },
    ];

    it("builds structured quiescent digest and formats markdown report", () => {
      const digest = buildQuiescentDigest({
        streak: 8,
        sources: mockObservations,
        runId: "run-mind-q8",
        generatedAt: "2026-09-01T12:00:00.000Z",
      });
      expect(digest.streak).toBe(8);
      expect(digest.runId).toBe("run-mind-q8");
      expect(digest.markdown).toContain("Quiescent Repository Digest (Streak 8)");
      expect(digest.markdown).toContain("code intent alignment");

      const md = formatQuiescentDigestMarkdown({
        streak: 8,
        runId: "run-mind-q8",
        generatedAt: "2026-09-01T12:00:00.000Z",
        sources: mockObservations,
      });
      expect(md).toContain("Verified Discovery Sources (10 of 10 Clean)");
    });

    it("executes quiesce lane in-memory and returns structured execution result", async () => {
      const vfs = setupVirtualMindFS();
      const capDir = "/capsules/run-lane-test";
      for (let i = 1; i <= 10; i++) {
        vfs.mkdirSync(`${capDir}/commands/cmd-${i}`, { recursive: true });
        vfs.writeFileSync(`${capDir}/commands/cmd-${i}/record.json`, JSON.stringify({ ok: true }));
      }
      const canonical = [
        "intent-drift:cmd-1:0",
        "unused-code:cmd-2:0",
        "literal-fallbacks:cmd-3:0",
        "open-findings:cmd-4:0",
        "escalated-tasks:cmd-5:0",
        "failing-gates:cmd-6:0",
        "capsule-integrity:cmd-7:0",
        "install-drift:cmd-8:0",
        "unsealed-capsules:cmd-9:0",
        "charter-backlog:cmd-10:0",
      ];
      const result = await executeQuiesceLane({
        runRoot: capDir,
        runId: "run-lane-test",
        sources: canonical,
        previousStreak: 7,
      });
      expect(result.ok).toBe(true);
      expect(result.streak).toBe(8);
      expect(result.digest).toBeDefined();
      expect(result.nextIntervalMs).toBeGreaterThanOrEqual(DEFAULT_BASE_INTERVAL_MS);
      expect(result.nextIntervalMs).toBeLessThanOrEqual(DEFAULT_MAX_INTERVAL_MS);
    });
  });
});
