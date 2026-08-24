import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { AGENT_ROLES } from "../../../olt/scripts/src/core/contracts/packets.ts";
import {
  loadRoleContract,
  resolveRoleContractPath,
} from "../../../olt/scripts/src/packets/role-contract.ts";
import { COMMAND_REGISTRY, findCommand } from "../../../olt/scripts/src/cli/registry/index.ts";

describe("Phase 4 Role Contracts Reconciliation", () => {
  test("scope role contract source files exist and contain valid frontmatter", () => {
    const orchestratorPath = resolveRoleContractPath("orchestrator");
    const coordinatorPath = resolveRoleContractPath("coordinator");

    expect(existsSync(orchestratorPath)).toBe(true);
    expect(existsSync(coordinatorPath)).toBe(true);

    const orchestratorContract = loadRoleContract("orchestrator");
    const coordinatorContract = loadRoleContract("coordinator");

    expect(orchestratorContract.role).toBe("orchestrator");
    expect(coordinatorContract.role).toBe("coordinator");
  });

  test("orchestrator contract matches PHASE-4 §3.1 specifications", () => {
    const contract = loadRoleContract("orchestrator");

    expect(contract.role).toBe("orchestrator");
    expect(contract.tier).toBe(1);
    expect(contract.spawns).toContain("coordinator");

    // orchestrator:run must be removed because it throws unconditionally without host executor
    expect(contract.commands).not.toContain("orchestrator:run");

    // Retains orchestrator commands
    expect(contract.commands).toContain("orchestrator:supervise");
    expect(contract.commands).toContain("doctor");
    expect(contract.commands).toContain("summary:export");

    // Invariants in must_not
    const mustNotText = contract.must_not.join("\n");
    expect(mustNotText).toContain(
      "Write, edit, stage, revert, format, or delete any repository file",
    );
  });

  test("coordinator contract matches PHASE-4 §3.1 specifications and removes dual-role prose", () => {
    const contract = loadRoleContract("coordinator");

    expect(contract.role).toBe("coordinator");
    expect(contract.tier).toBe(2);
    expect(contract.spawns).toContain("planner");
    expect(contract.spawns).toContain("implementer");
    expect(contract.spawns).toContain("validator");

    // coordinator does not hold orchestrator:run or round lifecycle commands
    expect(contract.commands).not.toContain("orchestrator:run");
    expect(contract.commands).not.toContain("mind:round-open");
    expect(contract.commands).not.toContain("mind:round-close");

    // Coordinator file content must not describe tier 1 loop running
    const rawPath = resolveRoleContractPath("coordinator");
    const rawContent = readFileSync(rawPath, "utf-8");

    expect(rawContent).not.toContain("orchestrator:run");
  });

  test("no role contract grants a command that unconditionally throws or does not exist", () => {
    const allRoles = AGENT_ROLES;
    const missingCommands: { role: string; command: string }[] = [];

    for (const role of allRoles) {
      const contract = loadRoleContract(role);
      for (const cmd of contract.commands) {
        const found = findCommand(cmd);
        if (!found) {
          missingCommands.push({ role, command: cmd });
        }
      }
    }

    expect(missingCommands).toEqual([]);
  });

  test("all commands in COMMAND_REGISTRY are well-formed and valid", () => {
    for (const cmd of COMMAND_REGISTRY) {
      expect(typeof cmd.name).toBe("string");
      expect(cmd.name.length).toBeGreaterThan(0);
      expect(typeof cmd.summary).toBe("string");
      expect(cmd.summary.length).toBeGreaterThan(0);
      expect(typeof cmd.handler).toBe("function");
    }
  });

  test("hierarchical spawning strictly obeys tier boundaries", () => {
    const orchestratorContract = loadRoleContract("orchestrator");
    expect(orchestratorContract.tier).toBe(1);
    expect(orchestratorContract.spawns).toContain("coordinator");

    const coordinatorContract = loadRoleContract("coordinator");
    expect(coordinatorContract.tier).toBe(2);
    expect(coordinatorContract.spawns).toContain("implementer");
    expect(coordinatorContract.spawns).toContain("validator");
  });

  test("full 4-tier hierarchy enforces strict non-bypassing spawn chain", () => {
    const mindContract = loadRoleContract("mind");
    expect(mindContract.tier).toBe(0);
    expect(mindContract.spawns).toEqual(["orchestrator"]);

    const orchestratorContract = loadRoleContract("orchestrator");
    expect(orchestratorContract.tier).toBe(1);
    expect(orchestratorContract.spawns).toContain("coordinator");

    const coordinatorContract = loadRoleContract("coordinator");
    expect(coordinatorContract.tier).toBe(2);
    expect(coordinatorContract.spawns).toContain("implementer");
    expect(coordinatorContract.spawns).toContain("validator");

    // Prohibit direct tier-bypassing dispatch from mind
    expect(mindContract.spawns).not.toContain("coordinator");
    expect(mindContract.spawns).not.toContain("validator");
  });
});
