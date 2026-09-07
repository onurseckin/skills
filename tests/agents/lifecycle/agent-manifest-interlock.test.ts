import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { parseAgentManifest } from "../../../olt/scripts/src/authority/manifest/index.ts";
import { cleanupVirtualAgentsFS, getVirtualAgentsFS, setupVirtualAgentsFS } from "../fixture.ts";

describe("Agent Manifest Supervisory Interlock & Confinement", () => {
  beforeEach(() => {
    const vfs = setupVirtualAgentsFS();
    const agentsDir = join(process.cwd(), "olt/agents");
    vfs.mkdirSync(agentsDir, { recursive: true });

    const createSupervisoryManifest = (role: string, tier: number) => `name: "${role}"
role: "${role}"
tier: ${tier}
tools:
  enable_subagent_tools: true
  enable_write_tools: false
interface:
  display_name: "${role.toUpperCase()} Supervisor"
invariants:
  - "SUPERVISOR_ZERO_CODE_EDITS"
`;

    vfs.writeFileSync(join(agentsDir, "mind.yaml"), createSupervisoryManifest("mind", 0));
    vfs.writeFileSync(
      join(agentsDir, "orchestrator.yaml"),
      createSupervisoryManifest("orchestrator", 1),
    );
    vfs.writeFileSync(
      join(agentsDir, "coordinator.yaml"),
      createSupervisoryManifest("coordinator", 1),
    );
  });

  afterEach(() => {
    cleanupVirtualAgentsFS();
  });

  it("mind manifest declares enable_write_tools: false and enable_subagent_tools: true", () => {
    const vfs = getVirtualAgentsFS();
    const mindYamlPath = join(process.cwd(), "olt/agents/mind.yaml");
    expect(vfs.existsSync(mindYamlPath)).toBe(true);
    const content = vfs.readFileSync(mindYamlPath, "utf-8");
    expect(content).toContain("enable_write_tools: false");
    expect(content).toContain("enable_subagent_tools: true");
    expect(content).toContain("SUPERVISOR_ZERO_CODE_EDITS");
  });

  it("orchestrator manifest declares enable_write_tools: false and enable_subagent_tools: true", () => {
    const vfs = getVirtualAgentsFS();
    const orchYamlPath = join(process.cwd(), "olt/agents/orchestrator.yaml");
    expect(vfs.existsSync(orchYamlPath)).toBe(true);
    const content = vfs.readFileSync(orchYamlPath, "utf-8");
    expect(content).toContain("enable_write_tools: false");
    expect(content).toContain("enable_subagent_tools: true");
    expect(content).toContain("SUPERVISOR_ZERO_CODE_EDITS");
  });

  it("coordinator manifest declares enable_write_tools: false and enable_subagent_tools: true", () => {
    const vfs = getVirtualAgentsFS();
    const coordYamlPath = join(process.cwd(), "olt/agents/coordinator.yaml");
    expect(vfs.existsSync(coordYamlPath)).toBe(true);
    const content = vfs.readFileSync(coordYamlPath, "utf-8");
    expect(content).toContain("enable_write_tools: false");
    expect(content).toContain("enable_subagent_tools: true");
    expect(content).toContain("SUPERVISOR_ZERO_CODE_EDITS");
  });

  it("parseAgentManifest correctly parses supervisory manifests with write tools disabled", () => {
    const vfs = getVirtualAgentsFS();
    const mindYamlPath = join(process.cwd(), "olt/agents/mind.yaml");
    const content = vfs.readFileSync(mindYamlPath, "utf-8");
    const parsed = parseAgentManifest(content, "olt/agents/mind.yaml");
    expect(parsed.tools?.enable_write_tools).toBe(false);
    expect(parsed.tools?.enable_subagent_tools).toBe(true);
    expect(parsed.invariants).toContain("SUPERVISOR_ZERO_CODE_EDITS");
  });
});
