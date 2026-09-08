/**
 * @file wall-clock-lint.test.ts
 * Unit tests for no-wall-clock-assertion purity lint rule.
 * Tests detection of wall-clock latency comparisons and ensures deterministic assertions pass.
 */

import { describe, expect, it } from "bun:test";
import { auditSourceCode } from "../../../../scripts/testing/guardrails/ast-checker.ts";

describe("Wall-Clock Test Lint Rule (no-wall-clock-assertion)", () => {
  it("flags expect(Date.now() - start).toBeLessThan(100)", () => {
    const code = `
      import { test, expect } from "bun:test";

      test("latency benchmark", () => {
        const start = Date.now();
        doSomething();
        expect(Date.now() - start).toBeLessThan(100);
      });
    `;
    const violations = auditSourceCode(code, "tests/timing.test.ts");
    expect(violations.length).toBeGreaterThanOrEqual(1);

    const v = violations.find((item) => item.rule === "no-wall-clock-assertion");
    expect(v).toBeDefined();
    expect(v?.category).toBe("anti_pattern");
    expect(v?.rule).toBe("no-wall-clock-assertion");
    expect(v?.message).toBe(
      "Wall-clock timing comparison detected in test. Tests must assert deterministic observable state instead of wall-clock latency.",
    );
    expect(v?.file).toBe("tests/timing.test.ts");
    expect(v?.line).toBe(7);
  });

  it("flags expect(elapsed).toBeLessThan(50)", () => {
    const code = `
      import { test, expect } from "bun:test";

      test("elapsed time check", () => {
        const elapsed = 42;
        expect(elapsed).toBeLessThan(50);
      });
    `;
    const violations = auditSourceCode(code, "tests/elapsed.test.ts");
    expect(violations.length).toBe(1);

    const v = violations[0];
    expect(v?.rule).toBe("no-wall-clock-assertion");
    expect(v?.category).toBe("anti_pattern");
    expect(v?.message).toContain("Wall-clock timing comparison detected in test");
  });

  it("allows deterministic assertions like expect(count).toBe(350)", () => {
    const code = `
      import { test, expect } from "bun:test";

      test("deterministic count assertion", () => {
        const count = 350;
        expect(count).toBe(350);
      });
    `;
    const violations = auditSourceCode(code, "tests/deterministic.test.ts");
    expect(violations).toHaveLength(0);
  });

  it("flags other timing identifiers such as duration, latencyMs, delta", () => {
    const code = `
      import { test, expect } from "bun:test";

      test("multiple timing assertions", () => {
        expect(duration).toBeLessThan(100);
        expect(latencyMs).toBeLessThanOrEqual(20);
        expect(delta).toBeGreaterThan(0);
      });
    `;
    const violations = auditSourceCode(code, "tests/identifiers.test.ts");
    expect(violations.filter((v) => v.rule === "no-wall-clock-assertion")).toHaveLength(3);
  });

  it("flags performance.now() comparisons", () => {
    const code = `
      import { test, expect } from "bun:test";

      test("performance.now comparison", () => {
        const t0 = performance.now();
        expect(performance.now() - t0).toBeLessThan(50);
      });
    `;
    const violations = auditSourceCode(code, "tests/perf.test.ts");
    expect(violations.some((v) => v.rule === "no-wall-clock-assertion")).toBe(true);
  });

  it("flags inverted comparisons where expected argument derives from wall-clock", () => {
    const code = `
      import { test, expect } from "bun:test";

      test("inverted comparisons", () => {
        expect(100).toBeGreaterThan(Date.now() - start);
        expect(50).toBeGreaterThan(elapsed);
      });
    `;
    const violations = auditSourceCode(code, "tests/inverted.test.ts");
    expect(violations.filter((v) => v.rule === "no-wall-clock-assertion")).toHaveLength(2);
  });

  it("flags binary comparison expressions inside assertions like expect(Date.now() - start < 100).toBe(true)", () => {
    const code = `
      import { test, expect } from "bun:test";

      test("boolean assertion of wall-clock inequality", () => {
        expect(Date.now() - start < 100).toBe(true);
        expect(Date.now() - start <= 100).toBeTruthy();
        expect(elapsed < 50).toBe(true);
      });
    `;
    const violations = auditSourceCode(code, "tests/binary-expect.test.ts");
    expect(violations.filter((v) => v.rule === "no-wall-clock-assertion")).toHaveLength(3);
  });

  it("flags binary comparison expressions inside assert / assert.ok", () => {
    const code = `
      import assert from "node:assert";
      import { test } from "bun:test";

      test("assert calls with wall-clock inequality", () => {
        assert(Date.now() - start < 100);
        assert.ok(Date.now() - start < 100);
        assert.ok(elapsed < 50);
      });
    `;
    const violations = auditSourceCode(code, "tests/assert.test.ts");
    expect(violations.filter((v) => v.rule === "no-wall-clock-assertion")).toHaveLength(3);
  });

  it("flags chained/negated assertions like expect(elapsed).not.toBeLessThan(50)", () => {
    const code = `
      import { test, expect } from "bun:test";

      test("negated comparison", () => {
        expect(elapsed).not.toBeLessThan(50);
      });
    `;
    const violations = auditSourceCode(code, "tests/negated.test.ts");
    expect(violations.filter((v) => v.rule === "no-wall-clock-assertion")).toHaveLength(1);
  });

  it("flags variables whose declarations derive from wall-clock expressions", () => {
    const code = `
      import { test, expect } from "bun:test";

      test("derived timing variable", () => {
        const diff = Date.now() - start;
        expect(diff).toBeLessThan(100);
      });
    `;
    const violations = auditSourceCode(code, "tests/derived.test.ts");
    expect(violations.filter((v) => v.rule === "no-wall-clock-assertion")).toHaveLength(1);
  });

  it("allows deterministic numeric assertions and comparisons", () => {
    const code = `
      import { test, expect } from "bun:test";

      test("clean numeric assertions", () => {
        const count = 350;
        expect(count).toBe(350);
        expect(count).toBeGreaterThan(0);
        expect(count).toBeLessThan(1000);
        expect(count).toBeLessThanOrEqual(350);
        expect(count).toBeGreaterThanOrEqual(100);
        expect([1, 2, 3].length).toBeLessThan(5);
      });
    `;
    const violations = auditSourceCode(code, "tests/numeric.test.ts");
    const wallClockViolations = violations.filter((v) => v.rule === "no-wall-clock-assertion");
    expect(wallClockViolations).toHaveLength(0);
  });
});
