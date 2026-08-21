import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AGENT_ROLES,
  type AgentRole,
} from "../../../orchestrating-long-tasks/scripts/src/contracts/packets.ts";
import {
  loadRoleContract,
  resolveRoleContractPath,
} from "../../../orchestrating-long-tasks/scripts/src/packets/role-contract.ts";
import {
  COMMAND_REGISTRY,
  findCommand,
} from "../../../orchestrating-long-tasks/scripts/src/cli/registry/index.ts";

describe("Phase 4 Role Contracts Reconciliation", () => {
  test("scope role contract source files exist and contain valid frontmatter", () => {
    const orchestratorPath = resolve("orchestrating-long-tasks/scripts/src/roles/orchestrator.md");
    const coordinatorPath = resolve("orchestrating-long-tasks/scripts/src/roles/coordinator.md");

    expect(existsSync(orchestratorPath)).toBe(true);
    expect(existsSync(coordinatorPath)).toBe(true);

    const orchestratorContent = readFileSync(orchestratorPath, "utf-8");
    const coordinatorContent = readFileSync(coordinatorPath, "utf-8");

    expect(orchestratorContent).toContain("role: orchestrator");
    expect(coordinatorContent).toContain("role: coordinator");
  });

  test("orchestrator contract matches PHASE-4 §3.1 specifications", () => {
    const contract = loadRoleContract("orchestrator");

    expect(contract.role).toBe("orchestrator");
    expect(contract.tier).toBe(1);
    expect(contract.spawns).toEqual(["coordinator"]);

    // orchestrator:run must be removed because it throws unconditionally without host executor
    expect(contract.commands).not.toContain("orchestrator:run");

    // mind:round-open and mind:round-close must be granted to tier 1 orchestrator
    expect(contract.commands).toContain("mind:round-open");
    expect(contract.commands).toContain("mind:round-close");

    // Retains other orchestrator commands
    expect(contract.commands).toContain("orchestrator:supervise");
    expect(contract.commands).toContain("recover");
    expect(contract.commands).toContain("doctor");
    expect(contract.commands).toContain("summary:export");

    // Invariants in must_not
    const mustNotText = contract.must_not.join("\n");
    expect(mustNotText).toContain("Write, edit, stage, revert, format, or delete any repository file");
    expect(mustNotText).toContain("Dispatch a tier 3 agent directly");
  });

  test("coordinator contract matches PHASE-4 §3.1 specifications and removes dual-role prose", () => {
    const contract = loadRoleContract("coordinator");

    expect(contract.role).toBe("coordinator");
    expect(contract.tier).toBe(2);
    expect(contract.spawns).toEqual([
      "planner",
      "implementer",
      "validator",
      "repairer",
      "completeness-critic",
    ]);

    // coordinator does not hold orchestrator:run or round lifecycle commands
    expect(contract.commands).not.toContain("orchestrator:run");
    expect(contract.commands).not.toContain("mind:round-open");
    expect(contract.commands).not.toContain("mind:round-close");

    // Coordinator file content must not describe tier 1 loop running
    const rawPath = resolveRoleContractPath("coordinator");
    const rawContent = readFileSync(rawPath, "utf-8");

    expect(rawContent).not.toContain("tier 1 loop runner");
    expect(rawContent).not.toContain("This contract covers both drivers");
    expect(rawContent.toLowerCase()).not.toContain("tier 1");
  });

  test("no role contract grants a command that unconditionally throws or does not exist", () => {
    const knownUnconditionallyThrowingCommands = new Set(["orchestrator:run"]);

    for (const role of AGENT_ROLES) {
      const contract = loadRoleContract(role);

      for (const commandName of contract.commands) {
        // Must exist in CLI command registry
        const spec = findCommand(commandName);
        expect(spec).toBeDefined();

        // Must not grant commands known to throw unconditionally in CLI mode
        expect(knownUnconditionallyThrowingCommands.has(commandName)).toBe(false);
      }
    }
  });

  test("all commands in COMMAND_REGISTRY are well-formed and valid", () => {
    for (const spec of COMMAND_REGISTRY) {
      expect(spec.name).toMatch(/^[a-z][a-z-]*(?::[a-z][a-z-]*)?$/u);
      expect(typeof spec.handler).toBe("function");
      expect(spec.domain).toBeDefined();
    }
  });

  test("hierarchical spawning strictly obeys tier boundaries", () => {
    const orchestratorContract = loadRoleContract("orchestrator");
    expect(orchestratorContract.tier).toBe(1);
    expect(orchestratorContract.spawns).toEqual(["coordinator"]);

    const coordinatorContract = loadRoleContract("coordinator");
    expect(coordinatorContract.tier).toBe(2);
    for (const spawned of coordinatorContract.spawns) {
      const spawnedContract = loadRoleContract(spawned);
      expect(spawnedContract.tier).toBe(3);
    }
  });
});
