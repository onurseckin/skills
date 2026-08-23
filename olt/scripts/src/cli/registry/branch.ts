import {
  branchAbandonCommand,
  branchClaimCommand,
  branchCollectCommand,
  branchOpenCommand,
  branchStatusCommand,
  branchSubmitCommand,
} from "../commands/branch-ops.ts";
import {
  DEFAULT_EXIT_CODES,
  optionalFlag,
  repeatableFlag,
  requiredFlag,
  type CommandSpec,
  type FlagSpec,
} from "./types.ts";

const runFlag = requiredFlag("run", "string", "Capsule run root.");
const branchFlag = requiredFlag("branch", "string", "Branch id returned by branch:open.");
const actorFlag = optionalFlag("actor", "string", "Event actor; defaults to the acting agent.");
const repoFlag: FlagSpec = optionalFlag(
  "repo",
  "string",
  "Repository root observed through Git; falls back to the current directory.",
);

export const BRANCH_COMMANDS: readonly CommandSpec[] = [
  {
    name: "branch:open",
    aliases: [],
    domain: "branch",
    summary: "Subdivide the work you hold into sub-tasks a sub-agent can take.",
    description:
      "A branch is an execution-time subdivision, never a plan task, so it never touches the plan revision. The parent moves to `branched` and its lease clock freezes until collect or abandon, which is what stops a parent blocked on children from being reaped as stale. Every sub-task scope must be a STRICTLY PROPER subset of the parent scope and stay disjoint from its siblings; a violation is refused, not trimmed. That proper-subset rule is what makes a chain of branches terminate. --parent-task accepts a plan task or another branch's sub-task; config max_branch_depth (default 5) is an escalation tripwire on nesting rather than a structural bound, and config max_agents (default 100) caps the grants a run may issue at any depth — a branch is charged one grant per sub-task up front.",
    flags: [
      runFlag,
      requiredFlag("parent-task", "string", "Plan task or sub-task the branch hangs off."),
      requiredFlag("agent", "string", "Agent holding the parent lease."),
      requiredFlag("token", "string", "Parent lease bearer token."),
      requiredFlag("reason", "string", "Why the work had to be subdivided."),
      repeatableFlag("sub-task", "string", "Sub-task id; repeat the flag for each sub-task."),
      repeatableFlag("sub-label", "string", "`<sub-task-id>=<label>`; one per sub-task."),
      repeatableFlag("sub-scope", "string", "`<sub-task-id>=<path>`; repeat for each path."),
      repeatableFlag(
        "sub-gate",
        "string",
        "`<sub-task-id>=<command>`; optional revalidation gate.",
      ),
      repoFlag,
      actorFlag,
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      'bun harness.ts branch:open --run .olt/capsules/<run-id> --parent-task task-1 --agent worker-1 --token <token> --reason "parser rewrite blocks the API change" --sub-task S-1 --sub-label S-1="Fix the parser" --sub-scope S-1=src/one/parser',
    ],
    handler: branchOpenCommand,
  },
  {
    name: "branch:claim",
    aliases: [],
    domain: "branch",
    summary: "Lease one branch sub-task to a sub-agent.",
    description:
      "Returns the bearer token the sub-agent echoes back to branch:submit. The lease expires like any other, and `recover` reclaims it if the sub-agent dies.",
    flags: [
      runFlag,
      branchFlag,
      requiredFlag("sub-task", "string", "Sub-task id to claim."),
      requiredFlag("agent", "string", "Sub-agent receiving the lease."),
      requiredFlag(
        "role",
        "string",
        "Branch role the sub-agent works under: sub-implementer, sub-investigator or sub-validator.",
      ),
      optionalFlag("lease-seconds", "int", "Lease length in seconds (5-86400)."),
      repoFlag,
      actorFlag,
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts branch:claim --run .olt/capsules/<run-id> --branch B-<uuid> --sub-task S-1 --agent sub-1 --role sub-implementer",
    ],
    handler: branchClaimCommand,
  },
  {
    name: "branch:submit",
    aliases: [],
    domain: "branch",
    summary: "Hand a finished sub-task back to the branch.",
    description:
      "Records what the sub-agent reports it did and releases the sub-lease. The summary is agent-reported; the file-level truth is measured once, by branch:collect.",
    flags: [
      runFlag,
      branchFlag,
      requiredFlag("sub-task", "string", "Sub-task id being submitted."),
      requiredFlag("agent", "string", "Sub-agent holding the sub-lease."),
      requiredFlag("token", "string", "Sub-lease bearer token."),
      requiredFlag("summary", "string", "What the sub-agent changed."),
      actorFlag,
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      'bun harness.ts branch:submit --run .olt/capsules/<run-id> --branch B-<uuid> --sub-task S-1 --agent sub-1 --token <token> --summary "Parser accepts the new grammar"',
    ],
    handler: branchSubmitCommand,
  },
  {
    name: "branch:collect",
    aliases: [],
    domain: "branch",
    summary: "Take the branch back and resume the parent.",
    description:
      "Refuses while any sub-task is still live. Records a real Git observation of the worktree delta across the branch window as harness_observed evidence, restores the parent lease with a fresh expiry and returns the parent to `running`. When the repository cannot be observed the file list stays absent rather than becoming an empty one.",
    flags: [
      runFlag,
      branchFlag,
      requiredFlag("agent", "string", "Parent agent that opened the branch."),
      requiredFlag("token", "string", "Parent lease bearer token."),
      requiredFlag("summary", "string", "What came back from the sub-agents."),
      repoFlag,
      actorFlag,
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      'bun harness.ts branch:collect --run .olt/capsules/<run-id> --branch B-<uuid> --agent worker-1 --token <token> --summary "Parser fixed; API change unblocked"',
    ],
    handler: branchCollectCommand,
  },
  {
    name: "branch:abandon",
    aliases: [],
    domain: "branch",
    summary: "Give up on a branch and resume the parent.",
    description:
      "The failure path. Every non-terminal sub-task is marked abandoned and its lease released, then the parent gets its lease back and returns to `running` to carry the work itself.",
    flags: [
      runFlag,
      branchFlag,
      requiredFlag("agent", "string", "Parent agent that opened the branch."),
      requiredFlag("token", "string", "Parent lease bearer token."),
      requiredFlag("reason", "string", "Why the branch is being given up."),
      actorFlag,
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      'bun harness.ts branch:abandon --run .olt/capsules/<run-id> --branch B-<uuid> --agent worker-1 --token <token> --reason "sub-agent could not reproduce the failure"',
    ],
    handler: branchAbandonCommand,
  },
  {
    name: "branch:status",
    aliases: [],
    domain: "branch",
    summary: "Show which branches are open and what they are waiting on.",
    description:
      "Lists open branches by default with the reason each one was opened. --all includes collected and abandoned ones, --branch narrows to one and --task narrows to a parent.",
    flags: [
      runFlag,
      optionalFlag("branch", "string", "Show only this branch."),
      optionalFlag("task", "string", "Show only branches under this parent."),
      optionalFlag("all", "bool", "Include collected and abandoned branches."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts branch:status --run .olt/capsules/<run-id>",
      "bun harness.ts branch:status --run .olt/capsules/<run-id> --task task-1 --all",
    ],
    handler: branchStatusCommand,
  },
];
