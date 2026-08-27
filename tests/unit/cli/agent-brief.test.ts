import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  agentBriefCommand,
  executeAgentBrief,
} from "../../../olt/scripts/src/cli/commands/agent-brief.ts";

describe("executeAgentBrief", () => {
  const scratchBase = join(process.cwd(), "coverage", "scratch", "agent-brief");

  afterAll(() => {
    rmSync(scratchBase, { recursive: true, force: true });
  });

  test("renders allowed commands from the canonical repository policy", () => {
    const repoRoot = join(scratchBase, "custom-policy");
    const policyPath = join(repoRoot, ".olt", "policy.json");
    mkdirSync(join(repoRoot, ".olt"), { recursive: true });
    writeFileSync(
      policyPath,
      JSON.stringify({ allowed_commands: ["bun test tests/unit/cli/agent-brief.test.ts"] }),
      "utf-8",
    );

    const brief = executeAgentBrief({ role: "implementer", repoRoot });

    expect(brief).toContain("GLOBAL CAPABILITIES AVAILABLE (POLICY):");
    expect(brief).toContain("  - bun test tests/unit/cli/agent-brief.test.ts");
  });

  test("fails closed when the canonical repository policy is invalid", () => {
    const repoRoot = join(scratchBase, "invalid-policy");
    const policyPath = join(repoRoot, ".olt", "policy.json");
    mkdirSync(join(repoRoot, ".olt"), { recursive: true });
    writeFileSync(policyPath, "{ invalid json", "utf-8");

    expect(() => executeAgentBrief({ role: "implementer", repoRoot })).toThrow(
      /Repository policy.*invalid/i,
    );
    try {
      executeAgentBrief({ role: "implementer", repoRoot });
      throw new Error("expected invalid policy to throw");
    } catch (error) {
      expect(error).toHaveProperty("code", "INTEGRITY");
      expect(String((error as Error).message)).toContain(policyPath);
    }
  });

  test("fails closed when the canonical repository policy path is unreadable", () => {
    const repoRoot = join(scratchBase, "unreadable-policy");
    const policyPath = join(repoRoot, ".olt", "policy.json");
    mkdirSync(policyPath, { recursive: true });

    expect(() => executeAgentBrief({ role: "implementer", repoRoot })).toThrow(
      /Repository policy.*invalid/i,
    );
    try {
      executeAgentBrief({ role: "implementer", repoRoot });
      throw new Error("expected unreadable policy to throw");
    } catch (error) {
      expect(error).toHaveProperty("code", "INTEGRITY");
      expect(String((error as Error).message)).toContain(policyPath);
      expect(String((error as Error).message)).toMatch(/directory|EISDIR/i);
    }
  });

  test("resolves policy from the repository containing the CLI working directory", async () => {
    const repoRoot = join(scratchBase, "nested-repository");
    const nestedDirectory = join(repoRoot, "packages", "worker");
    const policyPath = join(repoRoot, ".olt", "policy.json");
    mkdirSync(nestedDirectory, { recursive: true });
    mkdirSync(join(repoRoot, ".olt"), { recursive: true });
    writeFileSync(
      policyPath,
      JSON.stringify({ allowed_commands: ["repository-root-command"] }),
      "utf-8",
    );

    const result = await agentBriefCommand({ role: "implementer" }, nestedDirectory);

    expect(String(result.markdown)).toContain("  - repository-root-command");
  });
});
