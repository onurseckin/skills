import { describe, expect, it } from "bun:test";
import {
  deriveWriteScopeForCategory,
  deriveGateForCategory,
} from "../../../../olt/scripts/src/mind/tasks/smart/executor/orchestrator.ts";

describe("Mind Strategy Lanes & Repair Suite", () => {
  it("computes lane write scopes for scaling and core engine", () => {
    const scopeScaling = deriveWriteScopeForCategory("SCALING", "scale-task");
    expect(scopeScaling).toContain("olt/scripts/src/workflow/");

    const scopeEngine = deriveWriteScopeForCategory("CORE_ENGINE", "core-task");
    expect(scopeEngine).toContain("olt/scripts/src/mind/core-task.ts");
  });

  it("derives gate commands for repair lanes", () => {
    const gate = deriveGateForCategory("CORE_ENGINE", ["olt/scripts/src/mind/core.ts", "tests/mind/core.test.ts"]);
    expect(gate).toContain("bun test");
  });
});
