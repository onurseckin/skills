import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  agentBriefCommand,
  agentDefineCommand,
  executeAgentBrief,
} from "../../../olt/scripts/src/cli/commands/agent-brief.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";

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

  test("injects mandatory Turn 1 dispatch template into coordinator runtime briefing", () => {
    const brief = executeAgentBrief({ role: "coordinator" });

    expect(brief).toContain(
      "SECTION 3.8: MANDATORY TURN 1 DISPATCH TEMPLATE (ANTI-DIRECT-EXECUTION SENTINEL)",
    );
    expect(brief).toContain(
      "CRITICAL ANTI-DIRECT-EXECUTION INVARIANT (SUPERVISOR_ZERO_CODE_EDITS / ROLE_BOUNDARY_DEVIATION)",
    );
    expect(brief).toContain("Coordinators are Tier 2 pure wave orchestrators and dispatchers.");
    expect(brief).toContain("MANDATORY TURN 1 EXECUTION SEQUENCE:");
    expect(brief).toContain("bun harness.ts plan:compile --run <run_id>");
    expect(brief).toContain("invoke_subagent({");
    expect(brief).toContain('"Subagents": [');
    expect(brief).toContain('"TypeName": "implementer"');
    expect(brief).toContain('"TypeName": "validator"');
  });

  test("throws HarnessError if agent manifest is not found for role", () => {
    expect(() => executeAgentBrief({ role: "nonexistent_role_xyz" })).toThrow(HarnessError);
  });

  test("resolves diverse roles and host bindings", () => {
    const roles = ["validator", "critic", "mind", "worker"];
    for (const r of roles) {
      const brief = executeAgentBrief({ role: r, host: "antigravity" });
      expect(brief).toContain("SECTION 1: SYSTEM IDENTITY");
      expect(brief).toContain("SECTION 2: CONSTITUTIONAL PERMISSIONS");
    }
  });

  test("renders capsule milestone evidence verification when capsulePath is provided", async () => {
    const repoRoot = join(scratchBase, "capsule-evidence-repo");
    mkdirSync(repoRoot, { recursive: true });
    const runRoot = initRun(
      repoRoot,
      "evidence-test-run",
      new TextEncoder().encode("prompt"),
      "file",
      true,
    );

    const brief = executeAgentBrief({
      role: "implementer",
      repoRoot,
      capsulePath: runRoot,
    });

    expect(brief).toContain("SECTION 3.5: CAPSULE MILESTONE EVIDENCE VERIFICATION");
    expect(brief).toContain(`CAPSULE: ${runRoot}`);
  });

  test("agentBriefCommand validates arguments and executes brief with run flag", async () => {
    // Missing role
    await expect(agentBriefCommand({})).rejects.toThrow(HarnessError);

    // Invalid host
    await expect(
      agentBriefCommand({
        role: "implementer",
        host: "invalid_host_123",
      }),
    ).rejects.toThrow(HarnessError);

    const repoRoot = join(scratchBase, "brief-cmd-run-repo");
    mkdirSync(repoRoot, { recursive: true });
    const runRoot = initRun(
      repoRoot,
      "brief-cmd-run",
      new TextEncoder().encode("prompt"),
      "file",
      true,
    );

    // Valid host, format, and run
    const res = await agentBriefCommand({
      role: "implementer",
      host: "claude_code",
      format: "markdown",
      run: runRoot,
    });
    expect(res.markdown).toBeDefined();
    expect(String(res.markdown)).toContain("SECTION 1: SYSTEM IDENTITY");
    expect(res.milestone_evidence).toBeDefined();
  });

  test("agentDefineCommand returns placeholder response", async () => {
    const res = await agentDefineCommand({});
    expect(res.markdown).toContain("agent:define not fully implemented yet");
  });
});
