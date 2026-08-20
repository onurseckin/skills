import { describe, expect, it } from "bun:test";
import {
  classifyFailure,
  nextBackoffDelayMs,
  type FailureRecord,
} from "../../../orchestrating-long-tasks/scripts/src/orchestrator/failure-classifier.ts";

const NOW = new Date("2026-08-19T00:10:00.000Z");

describe("classifyFailure (B28.3)", () => {
  it("treats a rate limit as transient on the first attempt", () => {
    const result = classifyFailure({
      signal: "rate_limit",
      detail: "429 from provider",
      priorFailures: [],
      now: NOW,
    });
    expect(result.failureClass).toBe("transient");
    expect(result.repeatCount).toBe(1);
  });

  it("has no reason to expect a non-transient signal would behave differently on retry", () => {
    const result = classifyFailure({
      signal: "gate_failure",
      detail: "bun run typecheck exited 2",
      priorFailures: [],
      now: NOW,
    });
    expect(result.failureClass).toBe("deterministic");
  });

  it("stops retrying once the identical failure repeats past the threshold", () => {
    const prior: FailureRecord[] = [
      { signal: "timeout", detail: "host timeout after 120s", at: "2026-08-19T00:00:00.000Z" },
      { signal: "timeout", detail: "host timeout after 120s", at: "2026-08-19T00:02:00.000Z" },
    ];
    const result = classifyFailure({
      signal: "timeout",
      detail: "host timeout after 120s",
      priorFailures: prior,
      now: NOW,
      deterministicRepeatThreshold: 3,
    });
    expect(result.failureClass).toBe("deterministic");
    expect(result.repeatCount).toBe(3);
  });

  it("keeps retrying a transient signal that has not repeated identically", () => {
    const prior: FailureRecord[] = [
      { signal: "network", detail: "DNS failure", at: "2026-08-19T00:00:00.000Z" },
      { signal: "rate_limit", detail: "429 from provider", at: "2026-08-19T00:02:00.000Z" },
    ];
    const result = classifyFailure({
      signal: "provider_5xx",
      detail: "502 bad gateway",
      priorFailures: prior,
      now: NOW,
      deterministicRepeatThreshold: 3,
    });
    expect(result.failureClass).toBe("transient");
    expect(result.repeatCount).toBe(1);
  });

  it("gives up once the elapsed retry budget is spent, even below the repeat threshold", () => {
    const prior: FailureRecord[] = [
      { signal: "network", detail: "DNS failure", at: "2026-08-19T00:00:00.000Z" },
    ];
    const result = classifyFailure({
      signal: "network",
      detail: "DNS failure",
      priorFailures: prior,
      now: new Date("2026-08-19T05:00:00.000Z"),
      deterministicRepeatThreshold: 100,
      maxElapsedMs: 4 * 60 * 60_000,
    });
    expect(result.failureClass).toBe("deterministic");
    expect(result.reason).toContain("elapsed budget");
  });

  it("is unbounded in count on its own: neither bound alone stops a single fresh transient failure", () => {
    const result = classifyFailure({
      signal: "provider_5xx",
      detail: "503",
      priorFailures: [],
      now: NOW,
      deterministicRepeatThreshold: 3,
      maxElapsedMs: 60_000,
    });
    expect(result.failureClass).toBe("transient");
  });
});

describe("nextBackoffDelayMs", () => {
  it("grows exponentially with the repeat count, capped, before jitter is applied", () => {
    // random() = 1 always exercises the cap of the jitter draw (full jitter is a uniform draw in [0, cap)).
    const alwaysOne = () => 1;
    expect(nextBackoffDelayMs(1, { initialDelayMs: 1_000, random: alwaysOne })).toBe(1_000);
    expect(nextBackoffDelayMs(2, { initialDelayMs: 1_000, random: alwaysOne })).toBe(2_000);
    expect(nextBackoffDelayMs(3, { initialDelayMs: 1_000, random: alwaysOne })).toBe(4_000);
  });

  it("respects the maximum delay cap regardless of how large the repeat count grows", () => {
    const alwaysOne = () => 1;
    const delay = nextBackoffDelayMs(20, { initialDelayMs: 1_000, maxDelayMs: 30_000, random: alwaysOne });
    expect(delay).toBe(30_000);
  });

  it("draws uniformly between zero and the cap (full jitter), never a fixed value", () => {
    const alwaysZero = () => 0;
    expect(nextBackoffDelayMs(3, { initialDelayMs: 1_000, random: alwaysZero })).toBe(0);
  });
});
