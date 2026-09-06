import type { AgentOperationalContract } from "./types.ts";
import { defineContract, FORBIDDEN_WRITE_TOOLS } from "./types.ts";

export const ORCHESTRATION_CONTRACTS: readonly AgentOperationalContract[] = [
  defineContract({
    id: "domain-orchestrator",
    name: "Domain Orchestrator",
    role: "domain-orchestrator",
    tier: 1,
    category: "orchestration",
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
        "implementer",
        "ui-optical-validator",
        "ui-headless-validator",
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
];
