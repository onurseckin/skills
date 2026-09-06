import type { AgentOperationalContract } from "./types.ts";
import { defineContract, FORBIDDEN_WRITE_TOOLS, FORBIDDEN_EXEC_TOOLS } from "./archetypes.ts";

export const CONTRACTS_TIER_3_EXEC: readonly AgentOperationalContract[] = [
  defineContract({
    id: "sub-implementer",
    name: "Sub Implementer",
    role: "sub-implementer",
    tier: 3,
    category: "execution",
    toolBoundaries: {
      canWriteCode: true,
      canExecuteCommands: true,
      canSpawnSubagents: false,
      canClaimLeases: true,
      allowedTools: ["write_to_file", "replace_file_content", "bun test *", "bun harness.ts *"],
      forbiddenTools: ["authority:decide", "mind:admit", "mind:rotate"],
    },
    permissions: {
      may: ["Execute focused leaf code edits within leased file boundaries", "Run leaf unit tests"],
      mustNot: [
        "Spawn further subagents",
        "Run whole-suite tests",
        "Modify files outside assigned sub-lease",
      ],
      allowedCommands: ["bun harness.ts *", "bun test *"],
      forbiddenCommands: ["authority:decide", "mind:admit"],
      allowedSpawns: [],
    },
    invariants: ["LEAF_WORKER_CONFINEMENT", "STRICT_LEASE_CONFINEMENT", "ZERO_ANY_INVARIANT"],
    certifiedDeliverables: [
      {
        type: "leaf_implementation_diff",
        description: "Leaf Component Implementation Diff",
        evidenceRequired: true,
      },
    ],
  }),

  defineContract({
    id: "sub-investigator",
    name: "Sub Investigator",
    role: "sub-investigator",
    tier: 3,
    category: "execution",
    toolBoundaries: {
      canWriteCode: false,
      canExecuteCommands: false,
      canSpawnSubagents: false,
      canClaimLeases: false,
      allowedTools: ["grep_search", "find_by_name", "view_file", "list_dir", "bun harness.ts *"],
      forbiddenTools: [...FORBIDDEN_WRITE_TOOLS, ...FORBIDDEN_EXEC_TOOLS],
    },
    permissions: {
      may: [
        "Perform read-only forensic inspection, codebase searches, and defect root-cause analysis",
      ],
      mustNot: ["Edit files", "Execute commands", "Claim write leases"],
      allowedCommands: ["task:brief", "finding:get", "msg:send", "msg:recv", "msg:poll"],
      forbiddenCommands: [...FORBIDDEN_WRITE_TOOLS, ...FORBIDDEN_EXEC_TOOLS],
      allowedSpawns: [],
    },
    invariants: ["READ_ONLY_CONFINEMENT", "ZERO_MUTATION_FORENSICS"],
    certifiedDeliverables: [
      {
        type: "forensic_investigation_report",
        description: "Forensic Investigation & Root Cause Report",
        evidenceRequired: true,
      },
    ],
  }),

  defineContract({
    id: "publisher",
    name: "Publisher Subagent",
    role: "publisher",
    tier: 3,
    category: "execution",
    toolBoundaries: {
      canWriteCode: true,
      canExecuteCommands: true,
      canSpawnSubagents: false,
      canClaimLeases: false,
      allowedTools: [
        "worktree:land",
        "worktree:clean",
        "worktree:status",
        "task:check",
        "doctor",
        "whoami",
        "msg:send",
        "msg:recv",
      ],
      forbiddenTools: ["authority:decide", "mind:admit", "mind:rotate"],
    },
    permissions: {
      may: [
        "Execute atomic worktree landings and remote release publications via `worktree:land`",
        "Verify repository cleanliness and doctor status",
        "Perform worktree branch pruning and garbage collection via `worktree:clean`",
      ],
      mustNot: [
        "Modify application source files outside release transaction",
        "Claim implementation task leases",
        "Spawn child subagents",
      ],
      allowedCommands: [
        "worktree:land",
        "worktree:clean",
        "worktree:status",
        "task:check",
        "doctor",
        "whoami",
        "msg:send",
        "msg:recv",
      ],
      forbiddenCommands: ["authority:decide", "mind:admit"],
      allowedSpawns: [],
    },
    invariants: ["PUBLISHER_TRANSACTION_ISOLATION", "ZERO_SOURCE_EDITS", "ATOMIC_RELEASE_ONLY"],
    certifiedDeliverables: [
      {
        type: "worktree_landing_receipt",
        description: "Deterministic Worktree Landing & Git Push Receipt",
        evidenceRequired: true,
      },
    ],
  }),
];
