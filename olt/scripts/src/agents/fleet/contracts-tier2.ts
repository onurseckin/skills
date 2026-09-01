import type { AgentOperationalContract } from "./types.ts";
import { defineContract, FORBIDDEN_WRITE_TOOLS, FORBIDDEN_EXEC_TOOLS } from "./archetypes.ts";

export const CONTRACTS_TIER_2: readonly AgentOperationalContract[] = [
  defineContract({
    id: "domain-orchestrator",
    name: "Domain Orchestrator",
    role: "domain-orchestrator",
    tier: 1,
    category: "orchestration",
    aliases: ["orchestrator", "domain_orchestrator", "orch"],
    toolBoundaries: {
      canWriteCode: false,
      canExecuteCommands: true,
      canSpawnSubagents: true,
      canClaimLeases: false,
      allowedTools: ["bun harness.ts *"],
      forbiddenTools: [...FORBIDDEN_WRITE_TOOLS, "run:exec"],
    },
    permissions: {
      may: [
        "Decompose domain roadmap into feature tracks",
        "Spawn Feature Coordinators",
        "Track multi-wave progress",
      ],
      mustNot: ["Perform direct source code edits", "Claim task leases directly"],
      allowedCommands: ["bun harness.ts *"],
      forbiddenCommands: [...FORBIDDEN_WRITE_TOOLS, "run:exec"],
      allowedSpawns: [
        "feature-coordinator",
        "coordinator",
        "reasoning-specialist",
        "synthesis-specialist",
      ],
    },
    invariants: [
      "SUPERVISOR_ZERO_CODE_EDITS",
      "UNIDIRECTIONAL_DELEGATION",
      "MULTI_TRACK_ORCHESTRATION",
    ],
    certifiedDeliverables: [
      {
        type: "domain_roadmap_plan",
        description: "Domain Roadmap & Track Allocation",
        evidenceRequired: true,
      },
    ],
  }),

  defineContract({
    id: "feature-coordinator",
    name: "Feature Coordinator",
    role: "feature-coordinator",
    tier: 2,
    category: "orchestration",
    aliases: ["coordinator", "feature_coordinator", "coord"],
    toolBoundaries: {
      canWriteCode: false,
      canExecuteCommands: true,
      canSpawnSubagents: true,
      canClaimLeases: false,
      allowedTools: ["bun harness.ts *"],
      forbiddenTools: [...FORBIDDEN_WRITE_TOOLS, "run:exec"],
    },
    permissions: {
      may: [
        "Coordinate tactical feature swarms",
        "Spawn Implementers and Quality Validators",
        "Manage task queues",
      ],
      mustNot: ["Write application source code directly", "Re-run implementer unit tests"],
      allowedCommands: ["bun harness.ts *"],
      forbiddenCommands: [...FORBIDDEN_WRITE_TOOLS, "run:exec"],
      allowedSpawns: [
        "primary-implementer",
        "implementer",
        "autonomous-repairer",
        "repairer",
        "general-task-worker",
        "worker",
        "ui-cognitive-validator",
        "ui-visual-reviewer",
        "ui-headless-debugger",
        "ui-mechanic-validator",
        "general-validator",
        "validator",
        "completeness-critic",
        "system-critic",
        "task-critic",
      ],
    },
    invariants: [
      "SUPERVISOR_ZERO_CODE_EDITS",
      "ACTIVE_EXECUTION_NO_IDLE",
      "SOVEREIGN_EQUILIBRIUM_ENFORCEMENT",
    ],
    certifiedDeliverables: [
      {
        type: "feature_coordination_manifest",
        description: "Feature Swarm Dispatch Manifest",
        evidenceRequired: true,
      },
    ],
  }),

  defineContract({
    id: "host-platform-specialist",
    name: "Host Platform Specialist",
    role: "host-platform-specialist",
    tier: 2,
    category: "orchestration",
    aliases: ["platform-specialist", "host-specialist", "host-platform"],
    toolBoundaries: {
      canWriteCode: false,
      canExecuteCommands: true,
      canSpawnSubagents: false,
      canClaimLeases: false,
      allowedTools: ["bun harness.ts *"],
      forbiddenTools: [...FORBIDDEN_WRITE_TOOLS],
    },
    permissions: {
      may: [
        "Adapt execution policies to host operating system (mac/linux/win) and CLI tool bindings",
      ],
      mustNot: ["Modify source files directly"],
      allowedCommands: ["bun harness.ts *"],
      forbiddenCommands: [...FORBIDDEN_WRITE_TOOLS],
      allowedSpawns: [],
    },
    invariants: ["HOST_PLATFORM_ISOLATION", "SUPERVISOR_ZERO_CODE_EDITS"],
    certifiedDeliverables: [
      {
        type: "platform_binding_report",
        description: "Host Platform Binding Analysis",
        evidenceRequired: true,
      },
    ],
  }),

  defineContract({
    id: "reasoning-specialist",
    name: "Reasoning Specialist",
    role: "reasoning-specialist",
    tier: 2,
    category: "orchestration",
    aliases: ["planner", "reasoning-expert", "deliberation-specialist"],
    toolBoundaries: {
      canWriteCode: false,
      canExecuteCommands: true,
      canSpawnSubagents: false,
      canClaimLeases: false,
      allowedTools: ["bun harness.ts plan:*", "bun harness.ts msg:*"],
      forbiddenTools: [...FORBIDDEN_WRITE_TOOLS],
    },
    permissions: {
      may: ["Execute deliberate multi-step reasoning and algorithmic problem decomposition"],
      mustNot: ["Write application source code directly"],
      allowedCommands: ["bun harness.ts plan:*", "bun harness.ts msg:*"],
      forbiddenCommands: [...FORBIDDEN_WRITE_TOOLS],
      allowedSpawns: [],
    },
    invariants: ["MANDATORY_BRAINSTORM_BEFORE_COMPILE", "SUPERVISOR_ZERO_CODE_EDITS"],
    certifiedDeliverables: [
      {
        type: "reasoning_decomposition",
        description: "Algorithmic Reasoning Decomposition",
        evidenceRequired: true,
      },
    ],
  }),

  defineContract({
    id: "synthesis-specialist",
    name: "Synthesis Specialist",
    role: "synthesis-specialist",
    tier: 2,
    category: "orchestration",
    aliases: ["synthesis-expert", "summary-specialist", "synthesis"],
    toolBoundaries: {
      canWriteCode: false,
      canExecuteCommands: true,
      canSpawnSubagents: false,
      canClaimLeases: false,
      allowedTools: ["bun harness.ts *"],
      forbiddenTools: [...FORBIDDEN_WRITE_TOOLS],
    },
    permissions: {
      may: ["Synthesize multi-agent outputs, wave completion artifacts, and executive summaries"],
      mustNot: ["Direct source code modification"],
      allowedCommands: ["bun harness.ts *"],
      forbiddenCommands: [...FORBIDDEN_WRITE_TOOLS],
      allowedSpawns: [],
    },
    invariants: ["SYNTHESIS_FIDELITY", "SUPERVISOR_ZERO_CODE_EDITS"],
    certifiedDeliverables: [
      {
        type: "executive_synthesis_summary",
        description: "Multi-Track Executive Synthesis Summary",
        evidenceRequired: true,
      },
    ],
  }),

  defineContract({
    id: "code-specialist",
    name: "Code Specialist",
    role: "code-specialist",
    tier: 2,
    category: "orchestration",
    aliases: ["code-architect", "code-expert", "code_specialist"],
    toolBoundaries: {
      canWriteCode: false,
      canExecuteCommands: true,
      canSpawnSubagents: false,
      canClaimLeases: false,
      allowedTools: ["bun harness.ts *"],
      forbiddenTools: [...FORBIDDEN_WRITE_TOOLS],
    },
    permissions: {
      may: [
        "Analyze static type topologies, AST contracts, and dependency graphs without direct mutation",
      ],
      mustNot: ["Direct file modifications without tactical implementer dispatch"],
      allowedCommands: ["bun harness.ts *"],
      forbiddenCommands: [...FORBIDDEN_WRITE_TOOLS],
      allowedSpawns: [],
    },
    invariants: ["STATIC_AST_AUTHORITY", "SUPERVISOR_ZERO_CODE_EDITS"],
    certifiedDeliverables: [
      {
        type: "ast_topology_analysis",
        description: "AST Topology & Contract Analysis",
        evidenceRequired: true,
      },
    ],
  }),

  defineContract({
    id: "refactoring-specialist",
    name: "Refactoring Specialist",
    role: "refactoring-specialist",
    tier: 2,
    category: "orchestration",
    aliases: ["refactoring-expert", "refactorer", "refactor-specialist"],
    toolBoundaries: {
      canWriteCode: false,
      canExecuteCommands: true,
      canSpawnSubagents: false,
      canClaimLeases: false,
      allowedTools: ["bun harness.ts *"],
      forbiddenTools: [...FORBIDDEN_WRITE_TOOLS],
    },
    permissions: {
      may: [
        "Formulate AST-safe migration blueprints and non-breaking interface refactoring strategies",
      ],
      mustNot: ["Direct source code modification"],
      allowedCommands: ["bun harness.ts *"],
      forbiddenCommands: [...FORBIDDEN_WRITE_TOOLS],
      allowedSpawns: [],
    },
    invariants: ["NON_BREAKING_REFACTORING_GUARANTEE", "SUPERVISOR_ZERO_CODE_EDITS"],
    certifiedDeliverables: [
      {
        type: "refactoring_migration_blueprint",
        description: "Refactoring & Migration Blueprint",
        evidenceRequired: true,
      },
    ],
  }),

  defineContract({
    id: "generic-autonomous-agent",
    name: "Generic Autonomous Agent",
    role: "generic-autonomous-agent",
    tier: 2,
    category: "orchestration",
    aliases: ["generic", "generic-agent", "autonomous-agent"],
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
      allowedSpawns: ["primary-implementer", "general-validator"],
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

  // --- Tier 3 Tactical Execution & Repair (5) ---
  defineContract({
    id: "primary-implementer",
    name: "Primary Implementer",
    role: "primary-implementer",
    tier: 3,
    category: "execution",
    aliases: ["implementer", "primary_implementer", "lead-implementer"],
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
