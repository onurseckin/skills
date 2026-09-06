import type { AgentOperationalContract } from "./types.ts";
import { defineContract, FORBIDDEN_WRITE_TOOLS } from "./types.ts";

export const SPECIALIST_CONTRACTS: readonly AgentOperationalContract[] = [
  defineContract({
    id: "reasoning-specialist",
    name: "Reasoning Specialist",
    role: "reasoning-specialist",
    tier: 2,
    category: "orchestration",
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
];
