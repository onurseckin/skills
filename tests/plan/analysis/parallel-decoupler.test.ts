import { describe, test, expect } from "bun:test";
import { dynamicWaveDecoupling } from "../../../olt/scripts/src/plan/parallel-decoupler.ts";
import { ANALYSIS_SUITES } from "./index.ts";
import {
  createInMemoryPlanFinding,
  createInMemoryPreEnhancedTask,
  createInMemoryScopePair,
  createSandboxDir,
  PLAN_DOMAIN_SUITES,
  scratchRoot,
} from "../index.ts";

describe("parallel-decoupler", () => {
  test("calculates dynamic wave decoupling correctly", () => {
    expect(dynamicWaveDecoupling(10, 2)).toBe(5);
    expect(dynamicWaveDecoupling(10, 3)).toBe(4);
    expect(dynamicWaveDecoupling(1, 5)).toBe(1);
    expect(dynamicWaveDecoupling(0, 5)).toBe(0);
    expect(ANALYSIS_SUITES).toContain("parallel-decoupler");
    expect(Object.keys(PLAN_DOMAIN_SUITES).length).toBe(3);

    const task = createInMemoryPreEnhancedTask({ taskId: "t-1" });
    expect(task.taskId).toBe("t-1");
    expect(task.priority).toBe(100);

    const finding = createInMemoryPlanFinding({ id: "F-99" });
    expect(finding.id).toBe("F-99");
    expect(finding.severity).toBe("critical");

    const scopes = createInMemoryScopePair();
    expect(scopes.scopeA).toHaveLength(2);
    expect(scopes.disjointScope).toHaveLength(2);

    const root = scratchRoot(import.meta.path, "test");
    expect(typeof root).toBe("string");
    const sandbox = createSandboxDir("test-sandbox");
    expect(typeof sandbox).toBe("string");
  });
});
