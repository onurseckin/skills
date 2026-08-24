import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("Orchestrator YAML Specification Unit Tests", () => {
  it("verifies orchestrator.yaml exists and contains valid required schema fields", () => {
    const yamlPath = join(import.meta.dir, "../../../olt/agents/orchestrator.yaml");
    expect(existsSync(yamlPath)).toBe(true);

    const content = readFileSync(yamlPath, "utf-8");
    expect(content).toContain('role: "orchestrator"');
    expect(content).toContain("tier: 1");
    expect(content).toContain('display_name: "Tier 1 Meta-Orchestrator & Loop Runner"');
    expect(content).toContain("enable_subagent_tools: true");
    expect(content).toContain("enable_write_tools: false");
    expect(content).toContain("SUPERVISOR_ZERO_CODE_EDITS");
    expect(content).toContain("SUPERVISOR_ZERO_TEST_RUNS");
    expect(content).toContain("MAX_AUTONOMOUS_ROUNDS_10");
    expect(content).toContain("STATE_CAPSULE_CHAINING");
    expect(content).toContain("DEFECT_SYNTHESIS_FAN_IN");
    expect(content).toContain("DYNAMIC_WAVE_DECOUPLING");
    expect(content).toContain("FAST_PATH_COMPACTION_N_1");
  });
});
