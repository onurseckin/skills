import { describe, expect, test } from "bun:test";
import {
  deriveGateConcurrencyCeiling,
  discoverHostConcurrencyCeiling,
} from "../../../olt/scripts/src/core/config/host-concurrency.ts";

const CONCURRENCY_VAR = "CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS";
const SESSION_VAR = "CLAUDE_CODE_SESSION_ID";

let homeCounter = 0;
function withTempHome(fn: (home: string) => void): void {
  const tempHome = `/virtual/host-concurrency-test-${++homeCounter}`;
  fn(tempHome);
}

describe("discoverHostConcurrencyCeiling (B27.2 — discover, do not assume)", () => {
  test("reads a host-published ceiling rather than assuming one", () => {
    withTempHome((home) => {
      const ceiling = discoverHostConcurrencyCeiling({
        homeDir: home,
        env: { [SESSION_VAR]: "s-1", [CONCURRENCY_VAR]: "20" },
      });
      expect(ceiling).toEqual({ value: 20, hostTool: "claude-code" });
    });
  });

  test("returns null — never an invented number — when the host publishes nothing", () => {
    withTempHome((home) => {
      const ceiling = discoverHostConcurrencyCeiling({
        homeDir: home,
        env: { [SESSION_VAR]: "s-1" },
      });
      expect(ceiling).toBeNull();
    });
  });

  test("returns null when no host is identified at all", () => {
    withTempHome((home) => {
      expect(discoverHostConcurrencyCeiling({ homeDir: home, env: {} })).toBeNull();
    });
  });

  test("rejects a non-positive or non-integer published value rather than passing it through", () => {
    withTempHome((home) => {
      const zero = discoverHostConcurrencyCeiling({
        homeDir: home,
        env: { [SESSION_VAR]: "s-1", [CONCURRENCY_VAR]: "0" },
      });
      expect(zero).toBeNull();
      const notAnInt = discoverHostConcurrencyCeiling({
        homeDir: home,
        env: { [SESSION_VAR]: "s-1", [CONCURRENCY_VAR]: "3.5" },
      });
      expect(notAnInt).toBeNull();
    });
  });
});

describe("deriveGateConcurrencyCeiling (B27.2 — a separate, lower ceiling for gate-running agents)", () => {
  test("halves the core count, since the local machine is the constraint there", () => {
    expect(deriveGateConcurrencyCeiling(10)).toBe(5);
    expect(deriveGateConcurrencyCeiling(4)).toBe(2);
  });

  test("never returns fewer than one lane, even on a single core", () => {
    expect(deriveGateConcurrencyCeiling(1)).toBe(1);
    expect(deriveGateConcurrencyCeiling(3)).toBe(1);
  });

  test("is always strictly the general host ceiling's constraint, not a copy of it", () => {
    const gate = deriveGateConcurrencyCeiling(10);
    const hostCeiling = 40;
    expect(gate).toBeLessThan(hostCeiling);
  });

  test("falls back to the real host's core count when none is injected", () => {
    const derived = deriveGateConcurrencyCeiling();
    expect(Number.isInteger(derived)).toBeTrue();
    expect(derived).toBeGreaterThanOrEqual(1);
  });

  test("falls back to cpuCount() when availableParallelism() is unusable", () => {
    const throwing = deriveGateConcurrencyCeiling(undefined, {
      availableParallelism: () => {
        throw new Error("unavailable on this host");
      },
      cpuCount: () => 8,
    });
    expect(throwing).toBe(4);

    const nonInteger = deriveGateConcurrencyCeiling(undefined, {
      availableParallelism: () => 3.5,
      cpuCount: () => 6,
    });
    expect(nonInteger).toBe(3);
  });

  test("falls back to the real cpus() count when only availableParallelism is overridden", () => {
    const derived = deriveGateConcurrencyCeiling(undefined, {
      availableParallelism: () => {
        throw new Error("unavailable on this host");
      },
    });
    expect(Number.isInteger(derived)).toBeTrue();
    expect(derived).toBeGreaterThanOrEqual(1);
  });

  test("returns exactly one lane when every core probe fails or is unusable", () => {
    const derived = deriveGateConcurrencyCeiling(undefined, {
      availableParallelism: () => 0,
      cpuCount: () => {
        throw new Error("cpus() unavailable");
      },
    });
    expect(derived).toBe(1);
  });
});
