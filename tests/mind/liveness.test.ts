import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_LIVENESS_GRACE_MS,
  DEFAULT_LIVENESS_INTERVAL_MS,
  DEFAULT_LIVENESS_THRESHOLD_MS,
  evaluateMindLiveness,
  EXIT_CODE_CHECK_FAILURE,
  EXIT_CODE_HEALTHY,
  EXIT_CODE_STALE,
  formatLivenessBrief,
  getExitCodeForStatus,
} from "../../olt/scripts/src/mind/lifecycle/liveness/index.ts";

const tempDirs: string[] = [];

function createTempDir(prefix = "mind-liveness-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
  tempDirs.length = 0;
});

describe("evaluateMindLiveness TypeScript module", () => {
  test("returns healthy when pulse is fresh within interval + grace", () => {
    const dir = createTempDir();
    const nowMs = 1_700_000_000_000;
    // Pulse closed 5 minutes ago (300,000 ms ago)
    const pulseTime = new Date(nowMs - 300_000).toISOString();
    const pulseFile = join(dir, "last_pulse.json");

    writeFileSync(
      pulseFile,
      JSON.stringify({
        at: pulseTime,
        pulse_id: "pulse-42",
        outcome: "nominal",
        next_wake_at: new Date(nowMs + 600_000).toISOString(),
      }),
      "utf-8",
    );

    const result = evaluateMindLiveness(dir, { nowMs });

    expect(result.status).toBe("healthy");
    expect(result.healthy).toBe(true);
    expect(result.exitCode).toBe(EXIT_CODE_HEALTHY);
    expect(result.metrics.pulseId).toBe("pulse-42");
    expect(result.metrics.outcome).toBe("nominal");
    expect(result.metrics.ageMs).toBe(300_000);
    expect(result.metrics.maxAllowedAgeMs).toBe(DEFAULT_LIVENESS_THRESHOLD_MS);
    expect(result.reason).toContain("Heartbeat is fresh");
  });

  test("returns stale when pulse age exceeds interval + grace (15m + 5m = 20m)", () => {
    const dir = createTempDir();
    const nowMs = 1_700_000_000_000;
    // Pulse closed 25 minutes ago (1,500,000 ms ago > 1,200,000 ms threshold)
    const pulseTime = new Date(nowMs - 1_500_000).toISOString();
    const pulseFile = join(dir, "last_pulse.json");

    writeFileSync(
      pulseFile,
      JSON.stringify({
        closed_at: pulseTime,
        pulse_id: "pulse-10",
        outcome: "quiescent",
        next_wake_at: new Date(nowMs - 600_000).toISOString(),
      }),
      "utf-8",
    );

    const result = evaluateMindLiveness(dir, { nowMs });

    expect(result.status).toBe("stale");
    expect(result.healthy).toBe(false);
    expect(result.exitCode).toBe(EXIT_CODE_STALE);
    expect(result.metrics.pulseId).toBe("pulse-10");
    expect(result.metrics.outcome).toBe("quiescent");
    expect(result.metrics.ageMs).toBe(1_500_000);
    expect(result.reason).toContain("Heartbeat is stale");
    expect(result.reason).toContain("PAGING OWNER");
  });

  test("returns missing_record when last_pulse.json does not exist", () => {
    const dir = createTempDir();
    const result = evaluateMindLiveness(dir);

    expect(result.status).toBe("missing_record");
    expect(result.healthy).toBe(false);
    expect(result.exitCode).toBe(EXIT_CODE_CHECK_FAILURE);
    expect(result.metrics.pulseId).toBeNull();
    expect(result.metrics.ageMs).toBeNull();
    expect(result.reason).toContain("Pulse record does not exist");
  });

  test("returns corrupted_record on invalid JSON or non-object content", () => {
    const dir = createTempDir();
    const pulseFile = join(dir, "last_pulse.json");

    writeFileSync(pulseFile, "{ broken json content", "utf-8");
    const result1 = evaluateMindLiveness(dir);
    expect(result1.status).toBe("corrupted_record");
    expect(result1.healthy).toBe(false);
    expect(result1.exitCode).toBe(EXIT_CODE_CHECK_FAILURE);
    expect(result1.reason).toContain("Failed to parse pulse record JSON");

    writeFileSync(pulseFile, JSON.stringify(["array", "not", "object"]), "utf-8");
    const result2 = evaluateMindLiveness(dir);
    expect(result2.status).toBe("corrupted_record");
    expect(result2.healthy).toBe(false);
    expect(result2.exitCode).toBe(EXIT_CODE_CHECK_FAILURE);
    expect(result2.reason).toContain("not a valid JSON object");
  });

  test("returns corrupted_record when timestamp is missing or unparseable", () => {
    const dir = createTempDir();
    const pulseFile = join(dir, "last_pulse.json");

    writeFileSync(pulseFile, JSON.stringify({ pulse_id: "p-1", outcome: "nominal" }), "utf-8");
    const result1 = evaluateMindLiveness(dir);
    expect(result1.status).toBe("corrupted_record");
    expect(result1.healthy).toBe(false);
    expect(result1.exitCode).toBe(EXIT_CODE_CHECK_FAILURE);
    expect(result1.reason).toContain("contains no valid timestamp");

    writeFileSync(
      pulseFile,
      JSON.stringify({ pulse_id: "p-1", at: "not-a-valid-date-timestamp" }),
      "utf-8",
    );
    const result2 = evaluateMindLiveness(dir);
    expect(result2.status).toBe("corrupted_record");
    expect(result2.healthy).toBe(false);
    expect(result2.exitCode).toBe(EXIT_CODE_CHECK_FAILURE);
    expect(result2.reason).toContain("unparseable timestamp");
  });

  test("respects custom interval, grace, and maxAllowedAgeMs options", () => {
    const dir = createTempDir();
    const nowMs = 1_700_000_000_000;
    // Pulse closed 100 seconds ago (100,000 ms)
    const pulseTime = new Date(nowMs - 100_000).toISOString();
    const pulseFile = join(dir, "last_pulse.json");

    writeFileSync(
      pulseFile,
      JSON.stringify({
        at: pulseTime,
        pulse_id: "pulse-custom",
        outcome: "nominal",
      }),
      "utf-8",
    );

    // Threshold = 60s + 30s = 90s (90,000 ms) -> 100s age is stale
    const staleResult = evaluateMindLiveness(dir, {
      nowMs,
      intervalMs: 60_000,
      graceMs: 30_000,
    });
    expect(staleResult.status).toBe("stale");
    expect(staleResult.healthy).toBe(false);
    expect(staleResult.exitCode).toBe(EXIT_CODE_STALE);
    expect(staleResult.metrics.maxAllowedAgeMs).toBe(90_000);

    // With higher threshold override = 150,000 ms -> 100s age is healthy
    const healthyResult = evaluateMindLiveness(dir, {
      nowMs,
      maxAllowedAgeMs: 150_000,
    });
    expect(healthyResult.status).toBe("healthy");
    expect(healthyResult.healthy).toBe(true);
    expect(healthyResult.exitCode).toBe(EXIT_CODE_HEALTHY);
  });

  test("supports alternative timestamp property names: closed_at, at, started_at, opened_at", () => {
    const dir = createTempDir();
    const nowMs = 1_700_000_000_000;
    const pulseTime = new Date(nowMs - 10_000).toISOString();
    const pulseFile = join(dir, "last_pulse.json");

    for (const key of ["closed_at", "at", "started_at", "opened_at"]) {
      writeFileSync(
        pulseFile,
        JSON.stringify({
          [key]: pulseTime,
          pulse_id: `pulse-${key}`,
          outcome: "nominal",
        }),
        "utf-8",
      );

      const result = evaluateMindLiveness(dir, { nowMs });
      expect(result.status).toBe("healthy");
      expect(result.metrics.pulseTimestamp).toBe(pulseTime);
      expect(result.metrics.pulseId).toBe(`pulse-${key}`);
    }
  });

  test("handles direct file path vs capsule directory path", () => {
    const dir = createTempDir();
    const pulseFile = join(dir, "custom_pulse.json");
    const nowMs = 1_700_000_000_000;
    const pulseTime = new Date(nowMs - 5_000).toISOString();

    writeFileSync(
      pulseFile,
      JSON.stringify({
        at: pulseTime,
        pulse_id: "pulse-direct",
        outcome: "nominal",
      }),
      "utf-8",
    );

    const result = evaluateMindLiveness(pulseFile, { nowMs });
    expect(result.status).toBe("healthy");
    expect(result.pulseFile).toBe(pulseFile);
  });

  test("formats liveness brief markdown correctly", () => {
    const status = {
      status: "healthy" as const,
      healthy: true,
      exitCode: 0,
      reason: "Heartbeat is fresh (age: 120s <= threshold: 1200s)",
      capsuleDir: "/path/to/capsule",
      pulseFile: "/path/to/capsule/last_pulse.json",
      metrics: {
        pulseId: "pulse-99",
        outcome: "nominal",
        pulseTimestamp: "2026-08-21T05:00:00.000Z",
        pulseTimeMs: 1_700_000_000_000,
        nextWakeAt: "2026-08-21T05:15:00.000Z",
        ageMs: 120_000,
        maxAllowedAgeMs: 1_200_000,
        intervalMs: DEFAULT_LIVENESS_INTERVAL_MS,
        graceMs: DEFAULT_LIVENESS_GRACE_MS,
      },
    };

    const brief = formatLivenessBrief(status);
    expect(brief).toContain("Mind Liveness Status: 🟢 HEALTHY");
    expect(brief).toContain("pulse-99");
    expect(brief).toContain("nominal");
    expect(brief).toContain("120s");
  });

  test("maps exit codes correctly with getExitCodeForStatus", () => {
    expect(getExitCodeForStatus("healthy")).toBe(0);
    expect(getExitCodeForStatus("stale")).toBe(2);
    expect(getExitCodeForStatus("missing_record")).toBe(3);
    expect(getExitCodeForStatus("corrupted_record")).toBe(3);
  });
});
