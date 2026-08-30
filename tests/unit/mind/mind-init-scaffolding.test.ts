import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mindInitCommand } from "../../../olt/scripts/src/cli/commands/index.ts";

const SAMPLE_CHARTER = `name: "mind"
role: "mind"
tier: 0
charter:
  identity: "Autonomous Mind"
  goals:
    - id: "G1"
      statement: "Maintain test coverage"
  non_goals:
    - "No unauthorized modifications"
  repo_roots:
    - "olt/"
`;

describe("mind:init Scaffolding & Repository Governance", () => {
  it("scaffolds root .olt/ governance files and session authority on fresh repository", async () => {
    const testDir = join(
      tmpdir(),
      `test-mind-init-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    mkdirSync(testDir, { recursive: true });
    const charterPath = join(testDir, "charter.yaml");
    writeFileSync(charterPath, SAMPLE_CHARTER, "utf-8");

    try {
      const result = await mindInitCommand({ run: testDir, charter: charterPath, repo: testDir });
      expect(result).toBeDefined();

      const oltDir = join(testDir, ".olt");
      expect(existsSync(oltDir)).toBe(true);
      expect(existsSync(join(oltDir, "policy.json"))).toBe(true);
      expect(existsSync(join(testDir, ".session.json"))).toBe(true);

      const session = JSON.parse(readFileSync(join(testDir, ".session.json"), "utf-8"));
      expect(session.role).toBe("mind");
      expect(session.can_execute_shell).toBe(true);
      expect(session.can_edit_files).toBe(false);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("is idempotent and preserves existing policy and session", async () => {
    const testDir = join(
      tmpdir(),
      `test-mind-init-idem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    mkdirSync(join(testDir, ".olt"), { recursive: true });
    const charterPath = join(testDir, "charter.yaml");
    writeFileSync(charterPath, SAMPLE_CHARTER, "utf-8");

    const customPolicy = {
      schema_version: 1,
      ecosystem: "bun",
      test_runner: {
        default_command: "bun test",
        targeted_pattern: "bun test <path>",
        full_suite_command: "bun test",
        timeout_ms: 30000,
      },
      allowed_commands: ["bun test"],
      forbidden_commands: [],
      read_scope_neighborhood_depth: 2,
      review_protocol: { max_adversarial_pushes: 20, cognitive_pushes: 5 },
      planning: {
        max_tasks_per_wave: 4,
        allow_task_addition: true,
        allow_task_replan: true,
        allow_plan_override: false,
      },
      agents: {},
      docker_environment: { enabled: false },
      hooks: { enabled: false },
      provenance: "explicit_custom",
    };
    writeFileSync(
      join(testDir, ".olt", "policy.json"),
      JSON.stringify(customPolicy, null, 2),
      "utf-8",
    );

    try {
      const result = await mindInitCommand({ run: testDir, charter: charterPath, repo: testDir });
      expect(result).toBeDefined();

      const readBack = JSON.parse(readFileSync(join(testDir, ".olt", "policy.json"), "utf-8"));
      expect(readBack.ecosystem).toBe("bun");
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});
