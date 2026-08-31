import { describe, expect, it } from "bun:test";
import {
  classifyFailure,
  nextBackoffDelayMs,
  type FailureRecord,
} from "../../../olt/scripts/src/orchestrator/failure-classifier.ts";

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

  it("stops retrying a crashing agent once the identical crash repeats past the threshold", () => {
    // `crash` is the one transient signal a repeat count is still allowed to demote (see the
    // module comment): the same agent dying the same way three times in a row is evidence about
    // the TASK, unlike the four provider/network signals covered below.
    const prior: FailureRecord[] = [
      {
        signal: "crash",
        detail: "lease expired with no submission",
        at: "2026-08-19T00:00:00.000Z",
      },
      {
        signal: "crash",
        detail: "lease expired with no submission",
        at: "2026-08-19T00:02:00.000Z",
      },
    ];
    const result = classifyFailure({
      signal: "crash",
      detail: "lease expired with no submission",
      priorFailures: prior,
      now: NOW,
      deterministicRepeatThreshold: 3,
    });
    expect(result.failureClass).toBe("deterministic");
    expect(result.repeatCount).toBe(3);
  });

  it("B28.3: never stops a rate-limit/network/5xx/timeout retry on repeat count alone — only elapsed time bounds it", () => {
    // The exact four B28.3 names as transient, each driven far past what used to be the repeat
    // threshold (3) with the elapsed budget left untouched. If a repeat-count cap ever creeps back
    // in for these four, this is the test that catches it.
    for (const signal of ["rate_limit", "network", "provider_5xx", "timeout"] as const) {
      const prior: FailureRecord[] = Array.from({ length: 49 }, (_, index) => ({
        signal,
        detail: "identical every time",
        at: new Date(NOW.valueOf() - (49 - index) * 1_000).toISOString(),
      }));
      const result = classifyFailure({
        signal,
        detail: "identical every time",
        priorFailures: prior,
        now: NOW,
        deterministicRepeatThreshold: 3,
        maxElapsedMs: 4 * 60 * 60_000,
      });
      expect(result.failureClass).toBe("transient");
      expect(result.repeatCount).toBe(50);
    }
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
    const delay = nextBackoffDelayMs(20, {
      initialDelayMs: 1_000,
      maxDelayMs: 30_000,
      random: alwaysOne,
    });
    expect(delay).toBe(30_000);
  });

  it("draws uniformly between zero and the cap (full jitter), never a fixed value", () => {
    const alwaysZero = () => 0;
    expect(nextBackoffDelayMs(3, { initialDelayMs: 1_000, random: alwaysZero })).toBe(0);
  });
});
