import { describe, expect, test } from "bun:test";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import {
  schedBackoffCommand,
  schedEvalCommand,
  schedJitterCommand,
} from "../../../olt/scripts/src/cli/commands/sched-ops.ts";

describe("Scheduling CLI commands", () => {
  test("sched:eval computes immediate rollover when pending work is present", () => {
    const res = schedEvalCommand({
      "pending-work": true,
    });
    expect(res.isImmediate).toBe(true);
    expect(res.intervalMs).toBe(0);
    expect(res.zeroValueStreak).toBe(0);
  });

  test("sched:eval computes quiescent backoff streak", () => {
    const res = schedEvalCommand({
      streak: 3,
      "base-interval": 1000,
      "max-interval": 30000,
      jitter: false,
    });
    expect(res.isImmediate).toBe(false);
    expect(typeof res.intervalMs).toBe("number");
    expect(res.intervalMs as number).toBeGreaterThanOrEqual(1000);
  });

  test("sched:backoff calculates various backoff strategies", () => {
    const expRes = schedBackoffCommand({
      streak: 2,
      "base-interval": 1000,
      strategy: "exponential",
    });
    expect(expRes.strategy).toBe("exponential");
    expect(typeof expRes.delayMs).toBe("number");

    const linRes = schedBackoffCommand({
      streak: 2,
      "base-interval": 1000,
      strategy: "linear",
    });
    expect(linRes.strategy).toBe("linear");
    expect(linRes.delayMs).toBe(3000);

    const fixedRes = schedBackoffCommand({
      streak: 5,
      "base-interval": 2000,
      strategy: "fixed",
    });
    expect(fixedRes.delayMs).toBe(2000);

    const immRes = schedBackoffCommand({
      streak: 5,
      strategy: "immediate",
    });
    expect(immRes.delayMs).toBe(0);
  });

  test("sched:jitter calculates bounded deterministic jitter", () => {
    const res1 = schedJitterCommand({
      interval: 10000,
      seed: 999,
      "jitter-ratio": "0.2",
    });
    const res2 = schedJitterCommand({
      interval: 10000,
      seed: 999,
      "jitter-ratio": "0.2",
    });

    expect(res1.intervalMs).toBe(res2.intervalMs);
    expect(res1.intervalMs as number).toBeGreaterThanOrEqual(8000);
    expect(res1.intervalMs as number).toBeLessThanOrEqual(12000);
  });

  test("CLI execute dispatches sched commands through registry", async () => {
    const evalRes = await execute(["sched:eval", "--pending-work"]);
    expect(evalRes.isImmediate).toBe(true);

    const backoffRes = await execute([
      "sched:backoff",
      "--streak",
      "1",
      "--base-interval",
      "500",
      "--strategy",
      "linear",
    ]);
    expect(backoffRes.delayMs).toBe(1000);

    const jitterRes = await execute(["sched:jitter", "--interval", "5000", "--seed", "42"]);
    expect(typeof jitterRes.intervalMs).toBe("number");
  });
});
