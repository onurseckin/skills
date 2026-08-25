import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("Directive p06: Agent Triad Architecture & Host Provider Taxonomy", () => {
  const root = join(import.meta.dir, "../../..");
  const skillRoot = join(root, "olt");
  const agentsDir = join(skillRoot, "agents");
  const referencesDir = join(skillRoot, "references");

  test("agent triad directories exist and maintain clean structural separation", () => {
    expect(existsSync(agentsDir)).toBeTrue();
    expect(existsSync(referencesDir)).toBeTrue();
  });

  test("all canonical agent entity profiles in agents/ declare provider taxonomy and unified configuration", () => {
    const canonicalAgentFiles = [
      { file: "mind.yaml", expectedRole: "mind", tier: 0 },
      { file: "mind-auditor.yaml", expectedRole: "mind-auditor", tier: 0 },
      { file: "orchestrator.yaml", expectedRole: "orchestrator", tier: 1 },
      { file: "coordinator.yaml", expectedRole: "coordinator", tier: 2 },
      { file: "planner.yaml", expectedRole: "planner", tier: 3 },
      { file: "implementer.yaml", expectedRole: "implementer", tier: 3 },
      { file: "worker.yaml", expectedRole: "implementer", tier: 3 },
      { file: "validator.yaml", expectedRole: "validator", tier: 3 },
      { file: "plan-validator.yaml", expectedRole: "plan-validator", tier: 3 },
      { file: "repairer.yaml", expectedRole: "repairer", tier: 3 },
      { file: "completeness-critic.yaml", expectedRole: "completeness-critic", tier: 3 },
      { file: "critic.yaml", expectedRole: "completeness-critic", tier: 3 },
      { file: "sub-implementer.yaml", expectedRole: "sub-implementer", tier: 3 },
      { file: "sub-validator.yaml", expectedRole: "sub-validator", tier: 3 },
      { file: "sub-investigator.yaml", expectedRole: "sub-investigator", tier: 3 },
    ];

    const supportedProviders = ["antigravity", "agy", "claude", "codex", "cursor", "generic"];

    for (const item of canonicalAgentFiles) {
      const filePath = join(agentsDir, item.file);
      expect(existsSync(filePath)).toBeTrue();
      const raw = readFileSync(filePath, "utf8");

      expect(raw).toContain(`role: "${item.expectedRole}"`);
      expect(raw).toContain(`tier: ${item.tier}`);
      expect(raw).toContain("zero_json: true");

      for (const provider of supportedProviders) {
        expect(raw).toContain(provider);
      }
    }
  });

  test("host provider taxonomy specifications exist for all supported providers", () => {
    const providers = [
      { file: "antigravity.yaml", provider: "antigravity", tool: "invoke_subagent" },
      { file: "claude.yaml", provider: "claude", tool: "Agent" },
      { file: "codex.yaml", provider: "codex", tool: "spawn_agent" },
      { file: "cursor.yaml", provider: "cursor", tool: "Task" },
      { file: "generic.yaml", provider: "generic", tool: "bun" },
      { file: "openai.yaml", provider: "openai", tool: "spawn_agent" },
    ];

    for (const spec of providers) {
      const filePath = join(agentsDir, spec.file);
      expect(existsSync(filePath)).toBeTrue();
      const raw = readFileSync(filePath, "utf8");

      expect(raw).toContain(`provider: "${spec.provider}"`);
      expect(raw).toContain("dispatch:");
      expect(raw).toContain("supported_tiers:");
      expect(raw).toContain(spec.tool);
    }
  });

  test("unified manifests in agents/ define valid configuration with capability boundaries and permissions", () => {
    const canonicalRoles = [
      "orchestrator",
      "coordinator",
      "implementer",
      "validator",
      "completeness-critic",
      "plan-validator",
      "repairer",
      "mind",
      "mind-auditor",
      "sub-implementer",
      "sub-validator",
      "sub-investigator",
      "planner",
    ];

    for (const role of canonicalRoles) {
      const filePath = join(agentsDir, `${role}.yaml`);
      expect(existsSync(filePath)).toBeTrue();
      const content = readFileSync(filePath, "utf8");

      expect(content).toContain("role:");
      expect(content).toContain("tier:");
      expect(content).toContain("permissions:");
      expect(content).toContain("may:");
      expect(content).toContain("must_not:");
      expect(content).toContain("commands:");
      expect(content).toContain("spawns:");
      expect(content).toContain("instructions:");
    }
  });

  test("references/ directory contains curated matrices without obsolete or poisoning files", () => {
    const expectedReferences = [
      "parity-matrix.md",
      "host-adapters.md",
      "cli-capabilities.md",
      "cli-capabilities.json",
      "cli.md",
      "protocol.md",
      "state-model.md",
      "topology-exemplar.md",
      "configuration.md",
      "failure-modes.md",
      "run-playbook.md",
      "schema-examples.md",
    ];

    const actualFiles = readdirSync(referencesDir);

    for (const expected of expectedReferences) {
      expect(actualFiles).toContain(expected);
      const filePath = join(referencesDir, expected);
      expect(existsSync(filePath)).toBeTrue();
    }

    // Verify parity matrix covers all providers
    const parityMatrix = readFileSync(join(referencesDir, "parity-matrix.md"), "utf8");
    expect(parityMatrix).toContain("Google Antigravity");
    expect(parityMatrix).toContain("Anthropic Claude Code");
    expect(parityMatrix).toContain("OpenAI Codex / ChatGPT");
    expect(parityMatrix).toContain("Cursor");
    expect(parityMatrix).toContain("Generic subagent CLI");

    // Verify host adapters covers tiered architecture
    const hostAdapters = readFileSync(join(referencesDir, "host-adapters.md"), "utf8");
    expect(hostAdapters).toContain("Tiered Agent Architecture");
    expect(hostAdapters).toContain("Milestone-Only Notification Protocol");
  });

  test("static invariant verification: zero any and zero suppressions in test files", () => {
    const testFileContent = readFileSync(__filename, "utf8");
    expect(testFileContent).not.toContain("@ts-" + "ignore");
    expect(testFileContent).not.toContain("@ts-" + "expect-error");
    expect(testFileContent).not.toContain("eslint-" + "disable");
    expect(testFileContent).not.toContain(": " + "any");
    expect(testFileContent).not.toContain("as " + "any");
  });
});
