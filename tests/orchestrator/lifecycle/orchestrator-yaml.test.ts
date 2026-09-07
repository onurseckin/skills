import { describe, expect, it } from "bun:test";
import { dirname, join } from "node:path";
import orchestratorYaml from "../../../olt/agents/orchestrator.yaml" with { type: "text" };
import {
  VirtualMemoryFS,
  createVirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Orchestrator YAML Specification Unit Tests", () => {
  it("verifies orchestrator.yaml exists and contains valid required schema fields", () => {
    const vfs = new VirtualMemoryFS();
    const session = createVirtualFSSession(vfs);
    const yamlPath = join(import.meta.dir, "../../../olt/agents/orchestrator.yaml");
    vfs.mkdirSync(dirname(yamlPath), { recursive: true });
    vfs.writeFileSync(yamlPath, orchestratorYaml);

    expect(vfs.existsSync(yamlPath)).toBe(true);

    const content = vfs.readFileSync(yamlPath, "utf-8");
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
    expect(content).toContain("QUOTA_FREEZE_ZERO_KILL_RESUME");

    session.cleanup();
  });
});
