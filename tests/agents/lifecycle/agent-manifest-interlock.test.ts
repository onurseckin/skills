import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseAgentManifest } from "../../../olt/scripts/src/authority/manifest/index.ts";
import { cleanupVirtualAgentsFS, setupVirtualAgentsFS } from "../fixture.ts";

describe("Agent Manifest Supervisory Interlock & Confinement", () => {
  beforeEach(() => {
    setupVirtualAgentsFS();
  });

  afterEach(() => {
    cleanupVirtualAgentsFS();
  });
  it("mind manifest declares enable_write_tools: true and enable_subagent_tools: true", () => {
    const mindYamlPath = join(process.cwd(), "olt/agents/mind.yaml");
    expect(existsSync(mindYamlPath)).toBe(true);
    const content = readFileSync(mindYamlPath, "utf-8");
    expect(content).toContain("enable_write_tools: true");
    expect(content).toContain("enable_subagent_tools: true");
    expect(content).toContain("SUPERVISOR_ZERO_CODE_EDITS");
  });

  it("orchestrator manifest declares enable_write_tools: true and enable_subagent_tools: true", () => {
    const orchYamlPath = join(process.cwd(), "olt/agents/orchestrator.yaml");
    expect(existsSync(orchYamlPath)).toBe(true);
    const content = readFileSync(orchYamlPath, "utf-8");
    expect(content).toContain("enable_write_tools: true");
    expect(content).toContain("enable_subagent_tools: true");
    expect(content).toContain("SUPERVISOR_ZERO_CODE_EDITS");
  });

  it("coordinator manifest declares enable_write_tools: true and enable_subagent_tools: true", () => {
    const coordYamlPath = join(process.cwd(), "olt/agents/coordinator.yaml");
    expect(existsSync(coordYamlPath)).toBe(true);
    const content = readFileSync(coordYamlPath, "utf-8");
    expect(content).toContain("enable_write_tools: true");
    expect(content).toContain("enable_subagent_tools: true");
    expect(content).toContain("SUPERVISOR_ZERO_CODE_EDITS");
  });

  it("parseAgentManifest correctly parses supervisory manifests with write tools enabled", () => {
    const mindYamlPath = join(process.cwd(), "olt/agents/mind.yaml");
    const content = readFileSync(mindYamlPath, "utf-8");
    const parsed = parseAgentManifest(content, "olt/agents/mind.yaml");
    expect(parsed.tools.enable_write_tools).toBe(true);
    expect(parsed.tools.enable_subagent_tools).toBe(true);
    expect(parsed.invariants).toContain("SUPERVISOR_ZERO_CODE_EDITS");
  });
});
