import type { AgentOperationalContract } from "./types.ts";
import { defineContract, FORBIDDEN_WRITE_TOOLS } from "./types.ts";

export const EXECUTION_GENERIC_CONTRACTS: readonly AgentOperationalContract[] = [
  defineContract({
    id: "generic-autonomous-agent",
    name: "Generic Autonomous Agent",
    role: "generic-autonomous-agent",
    tier: 2,
    category: "orchestration",
    toolBoundaries: {
      canWriteCode: false,
      canExecuteCommands: true,
      canSpawnSubagents: true,
      canClaimLeases: false,
      allowedTools: ["bun harness.ts *"],
      forbiddenTools: [...FORBIDDEN_WRITE_TOOLS],
    },
    permissions: {
      may: ["Execute generalized orchestration pipelines and standard lifecycle tasks"],
      mustNot: ["Bypass strict tier boundary constraints"],
      allowedCommands: ["bun harness.ts *"],
      forbiddenCommands: [...FORBIDDEN_WRITE_TOOLS],
      allowedSpawns: ["implementer", "general-validator"],
    },
    invariants: ["GENERIC_ADAPTOR_CONFINEMENT"],
    certifiedDeliverables: [
      {
        type: "generic_execution_receipt",
        description: "Generic Autonomous Execution Receipt",
        evidenceRequired: true,
      },
    ],
  }),

  // --- Tier 3 Tactical Execution & Repair ---
  defineContract({
    id: "implementer",
    name: "Primary Implementer",
    role: "implementer",
    tier: 3,
    category: "execution",
    toolBoundaries: {
      canWriteCode: true,
      canExecuteCommands: true,
      canSpawnSubagents: true,
      canClaimLeases: true,
      allowedTools: [
        "write_to_file",
        "replace_file_content",
        "bun test *",
        "bun harness.ts *",
        "git diff",
        "git status",
      ],
      forbiddenTools: ["authority:decide", "mind:admit", "mind:rotate"],
    },
    permissions: {
      may: [
        "Claim active task write leases",
        "Write, edit, and create application code and test suites",
        "Run unit tests (`bun test <specific-test>`)",
        "Spawn sub-implementers and sub-investigators",
      ],
      mustNot: [
        "Run whole-suite tests (whole-suite test runs are strictly banned)",
        "Bypass lease confinement",
        "Validate own work without independent validator sign-off",
      ],
      allowedCommands: ["bun harness.ts *", "bun test *", "git diff", "git status"],
      forbiddenCommands: ["authority:decide", "mind:admit", "mind:rotate"],
      allowedSpawns: ["sub-implementer", "sub-investigator", "sub-validator"],
    },
    invariants: [
      "STRICT_LEASE_CONFINEMENT",
      "ZERO_ANY_INVARIANT",
      "ZERO_SUPPRESSIONS_INVARIANT",
      "IMPLEMENTERS_OWN_UNIT_TESTING",
      "WHOLE_SUITE_TEST_BAN",
    ],
    certifiedDeliverables: [
      {
        type: "code_implementation_diff",
        description: "Clean AST Implementation Diff",
        evidenceRequired: true,
      },
      {
        type: "unit_test_receipt",
        description: "Passing Unit Test Execution Receipt",
        evidenceRequired: true,
      },
    ],
  }),
];
