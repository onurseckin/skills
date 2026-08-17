import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("Orchestrator YAML Specification Unit Tests", () => {
  it("verifies orchestrator.yaml exists and contains valid required schema fields", () => {
    const yamlPath = join(
      import.meta.dir,
      "../../../orchestrating-long-tasks/agents/orchestrator.yaml",
    );
    expect(existsSync(yamlPath)).toBe(true);

    const content = readFileSync(yamlPath, "utf-8");
    expect(content).toContain('role: "orchestrator"');
    expect(content).toContain("tier: 1");
    expect(content).toContain('display_name: "Meta-Orchestrator & Loop Runner"');
    expect(content).toContain("enable_subagent_tools: true");
    expect(content).toContain("enable_write_tools: true");
    expect(content).toContain("max_autonomous_rounds: 10");
    expect(content).toContain("state_capsule_chaining: true");
    expect(content).toContain("defect_synthesis_fan_in: true");
    expect(content).toContain("background_watchdog_monitoring: true");
    expect(content).toContain("triad_floor_enforcement: true");
    expect(content).toContain("zero_main_thread_pollution: true");
    expect(content).toContain(
      'cli: "bun ~/.agents/skills/orchestrating-long-tasks/scripts/harness.ts"',
    );
    expect(content).toContain("round_started: true");
    expect(content).toContain("round_completed: true");
    expect(content).toContain("defect_synthesis_ready: true");
    expect(content).toContain("capsule_chained: true");
    expect(content).toContain("loop_completed: true");
    expect(content).toContain("stall_detected: true");
    expect(content).toContain("auto_wake_triggered: true");
  });
});
