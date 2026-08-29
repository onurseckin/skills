import { describe, expect, test } from "bun:test";
import { OutputBudget } from "../../../olt/scripts/src/engine/runner/receipt/output-budget.ts";

describe("OutputBudget", () => {
  test("tracks consumed bytes across claims within the maximum", () => {
    const budget = new OutputBudget(100);
    budget.claim(40);
    budget.claim(30);
    expect(budget.consumed).toBe(70);
    expect(budget.maximum).toBe(100);
  });

  test("throws once a claim would exceed the maximum, leaving consumed unchanged", () => {
    const budget = new OutputBudget(50);
    budget.claim(50);
    expect(() => budget.claim(1)).toThrow("combined command output quota exceeded (50 bytes)");
    expect(budget.consumed).toBe(50);
  });

  test("allows a claim that exactly reaches the maximum", () => {
    const budget = new OutputBudget(10);
    budget.claim(10);
    expect(budget.consumed).toBe(10);
  });
});
