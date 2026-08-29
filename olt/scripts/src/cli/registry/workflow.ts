import {
  worktreeCleanCommand,
  worktreeCreateCommand,
  worktreeLandCommand,
  worktreeListCommand,
  worktreeReclaimCommand,
  worktreeStatusCommand,
} from "../commands/worktree-ops.ts";
import { DEFAULT_EXIT_CODES, optionalFlag, requiredFlag, type CommandSpec } from "./types.ts";

export const WORKFLOW_COMMANDS: readonly CommandSpec[] = [
  {
    name: "worktree:create",
    aliases: [],
    domain: "worktree",
    tier: "primary",
    internal: false,
    summary: "Create a hermetic track worktree with lock acquisition.",
    description:
      "Allocates a hermetic track worktree in .olt/worktrees/<track_id>, creates branch track/<track_id>, and acquires a POSIX lock.",
    flags: [
      requiredFlag("track", "string", "Track identifier."),
      optionalFlag("base-branch", "string", "Base branch to fork from (default: main).", "main"),
      optionalFlag("repo-root", "string", "Repository root path."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts worktree:create --track track-1",
      "bun harness.ts worktree:create --track track-1 --base-branch main",
    ],
    handler: worktreeCreateCommand,
  },
  {
    name: "worktree:land",
    aliases: [],
    domain: "worktree",
    tier: "primary",
    internal: false,
    summary: "Land a completed track worktree to main with immediate teardown.",
    description:
      "Performs upstream sync, rebases track onto main, fast-forwards/pushes, executes release hooks, writes telemetry, and tears down worktree and branch.",
    flags: [
      requiredFlag("track", "string", "Track identifier."),
      optionalFlag("remote", "string", "Git remote (default: origin).", "origin"),
      optionalFlag("target-branch", "string", "Target branch (default: main).", "main"),
      optionalFlag("repo-root", "string", "Repository root path."),
      optionalFlag("no-release-hook", "bool", "Skip executing post-land release hooks."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts worktree:land --track track-1",
      "bun harness.ts worktree:land --track track-1 --target-branch main",
    ],
    handler: worktreeLandCommand,
  },
  {
    name: "worktree:list",
    aliases: [],
    domain: "worktree",
    tier: "primary",
    internal: false,
    summary: "List all active track worktrees.",
    description:
      "Queries git porcelain and .olt/worktrees to report all currently active track worktrees.",
    flags: [optionalFlag("repo-root", "string", "Repository root path.")],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts worktree:list"],
    handler: worktreeListCommand,
  },
  {
    name: "worktree:clean",
    aliases: [],
    domain: "worktree",
    tier: "primary",
    internal: false,
    summary: "Clean up and remove track worktrees and branches.",
    description:
      "Removes specified worktree directory, deletes track branch, runs git worktree prune, and cleans lock file.",
    flags: [
      optionalFlag("track", "string", "Track identifier to clean."),
      optionalFlag("all", "bool", "Clean all active track worktrees."),
      optionalFlag("no-force", "bool", "Do not force removal."),
      optionalFlag("repo-root", "string", "Repository root path."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts worktree:clean --track track-1",
      "bun harness.ts worktree:clean --all",
    ],
    handler: worktreeCleanCommand,
  },
  {
    name: "worktree:status",
    aliases: [],
    domain: "worktree",
    tier: "primary",
    internal: false,
    summary: "Check status of active track worktrees.",
    description: "Reports active track worktree path, lock status, and branch information.",
    flags: [
      optionalFlag("track", "string", "Optional track identifier to check."),
      optionalFlag("repo-root", "string", "Repository root path."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts worktree:status", "bun harness.ts worktree:status --track track-1"],
    handler: worktreeStatusCommand,
  },
  {
    name: "worktree:reclaim",
    aliases: [],
    domain: "worktree",
    tier: "internal",
    internal: true,
    summary: "Reclaim abandoned worktrees from a completed or crashed run.",
    description:
      "B22.6: removes the worktree directories a crashed or abandoned run left behind. The harness branch and every per-task worktree branch are left untouched.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag(
        "actor",
        "string",
        "Who is running the reclaim. Recorded on the event; there is no default actor.",
      ),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts worktree:reclaim --run .olt/capsules/<run-id> --actor coordinator"],
    handler: worktreeReclaimCommand,
  },
];

export const WORKTREE_COMMANDS = WORKFLOW_COMMANDS;
