import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("Directive p06: Agent Triad Architecture & Host Provider Taxonomy", () => {
  const root = join(import.meta.dir, "../../..");
  const skillRoot = join(root, "orchestrating-long-tasks");
  const agentsDir = join(skillRoot, "agents");
  const rolesDir = join(skillRoot, "roles");
  const referencesDir = join(skillRoot, "references");

  test("agent triad directories exist and maintain clean structural separation", () => {
    expect(existsSync(agentsDir)).toBeTrue();
    expect(existsSync(rolesDir)).toBeTrue();
    expect(existsSync(referencesDir)).toBeTrue();
  });

  test("all canonical agent entity profiles in agents/ reference their role contracts and declare provider taxonomy", () => {
    const canonicalAgentFiles = [
      { file: "mind.yaml", expectedRole: "mind", tier: 0, contract: "roles/mind.md" },
      {
        file: "mind-auditor.yaml",
        expectedRole: "mind-auditor",
        tier: 1,
        contract: "roles/mind-auditor.md",
      },
      {
        file: "orchestrator.yaml",
        expectedRole: "orchestrator",
        tier: 1,
        contract: "roles/orchestrator.md",
      },
      {
        file: "coordinator.yaml",
        expectedRole: "coordinator",
        tier: 2,
        contract: "roles/coordinator.md",
      },
      { file: "planner.yaml", expectedRole: "planner", tier: 3, contract: "roles/planner.md" },
      {
        file: "implementer.yaml",
        expectedRole: "implementer",
        tier: 3,
        contract: "roles/implementer.md",
      },
      { file: "worker.yaml", expectedRole: "implementer", tier: 3, contract: "roles/implementer.md" },
      {
        file: "validator.yaml",
        expectedRole: "validator",
        tier: 3,
        contract: "roles/validator.md",
      },
      {
        file: "plan-validator.yaml",
        expectedRole: "plan-validator",
        tier: 3,
        contract: "roles/plan-validator.md",
      },
      { file: "repairer.yaml", expectedRole: "repairer", tier: 3, contract: "roles/repairer.md" },
      {
        file: "completeness-critic.yaml",
        expectedRole: "completeness-critic",
        tier: 3,
        contract: "roles/completeness-critic.md",
      },
      {
        file: "critic.yaml",
        expectedRole: "completeness-critic",
        tier: 3,
        contract: "roles/completeness-critic.md",
      },
      {
        file: "sub-implementer.yaml",
        expectedRole: "sub-implementer",
        tier: 3,
        contract: "roles/sub-implementer.md",
      },
      {
        file: "sub-validator.yaml",
        expectedRole: "sub-validator",
        tier: 3,
        contract: "roles/sub-validator.md",
      },
      {
        file: "sub-investigator.yaml",
        expectedRole: "sub-investigator",
        tier: 3,
        contract: "roles/sub-investigator.md",
      },
    ];

    const supportedProviders = ["antigravity", "agy", "claude", "codex", "cursor", "generic"];

    for (const item of canonicalAgentFiles) {
      const filePath = join(agentsDir, item.file);
      expect(existsSync(filePath)).toBeTrue();
      const raw = readFileSync(filePath, "utf8");

      expect(raw).toContain(`role: "${item.expectedRole}"`);
      expect(raw).toContain(`tier: ${item.tier}`);
      expect(raw).toContain(`role_contract: "${item.contract}"`);
      expect(raw).toContain("zero_json: true");

      for (const provider of supportedProviders) {
        expect(raw).toContain(provider);
      }

      // Verify that the referenced role contract file physically exists
      const contractPath = join(skillRoot, item.contract);
      expect(existsSync(contractPath)).toBeTrue();
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

  test("role contracts in roles/ define valid frontmatter with capability boundaries and permissions", () => {
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
      "validator-code-quality",
      "validator-product",
      "validator-security",
      "validator-system-design",
      "validator-ui-design",
    ];

    for (const role of canonicalRoles) {
      const filePath = join(rolesDir, `${role}.md`);
      expect(existsSync(filePath)).toBeTrue();
      const content = readFileSync(filePath, "utf8");

      // Verify YAML frontmatter
      expect(content.startsWith("---")).toBeTrue();
      const endFrontmatterIndex = content.indexOf("---", 3);
      expect(endFrontmatterIndex).toBeGreaterThan(0);

      const frontmatter = content.substring(3, endFrontmatterIndex);
      expect(frontmatter).toContain("role:");
      expect(frontmatter).toContain("tier:");
      expect(frontmatter).toContain("may:");
      expect(frontmatter).toContain("must_not:");
      expect(frontmatter).toContain("commands:");
      expect(frontmatter).toContain("spawns:");

      // Verify body provides operational procedure details
      const body = content.substring(endFrontmatterIndex + 3);
      expect(body.length).toBeGreaterThan(100);
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
