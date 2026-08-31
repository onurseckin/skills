import { describe, test, expect } from "bun:test";
import { dynamicWaveDecoupling } from "../../../olt/scripts/src/plan/parallel-decoupler.ts";
import { ANALYSIS_SUITES } from "./index.ts";
import { PLAN_DOMAIN_SUITES } from "../index.ts";

describe("parallel-decoupler", () => {
  test("calculates dynamic wave decoupling correctly", () => {
    expect(dynamicWaveDecoupling(10, 2)).toBe(5);
    expect(dynamicWaveDecoupling(10, 3)).toBe(4);
    expect(dynamicWaveDecoupling(1, 5)).toBe(1);
    expect(dynamicWaveDecoupling(0, 5)).toBe(0);
    expect(ANALYSIS_SUITES).toContain("parallel-decoupler");
    expect(Object.keys(PLAN_DOMAIN_SUITES).length).toBe(3);
  });
});
