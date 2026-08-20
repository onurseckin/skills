import {
  agentListCommand,
  agentRegisterCommand,
  agentReleaseCommand,
  agentReportCommand,
} from "../commands/agent-ops.ts";
import { CATEGORY_FLAG_HELP } from "../taxonomy-flags.ts";
import {
  DEFAULT_EXIT_CODES,
  optionalFlag,
  requiredFlag,
  type CommandSpec,
  type FlagSpec,
} from "./types.ts";

const toolFlag: FlagSpec = {
  name: "tool",
  type: "string",
  required: false,
  repeatable: true,
  description: `One tool as <name> or <name>=<category>; repeat the flag for each tool. ${CATEGORY_FLAG_HELP} A tool given without a category has none recorded.`,
};

const toolExtraFlag: FlagSpec = {
  name: "tool-extra",
  type: "string",
  required: false,
  repeatable: true,
  description:
    "One tool-specific fact as <tool>:<key>=<value>, kept verbatim under the reported name. The tool must also be given with --tool.",
};

export const AGENT_COMMANDS: readonly CommandSpec[] = [
  {
    name: "agent:register",
    aliases: [],
    domain: "agent",
    summary: "Record a dispatched subagent and mint its grant.",
    description:
      "Spawning happens host-side; this is how the run learns a subagent exists, who deployed it and under which task. Host-reported model, tier and thinking level, plus the granted toolset the dispatcher relays, are recorded only when supplied and stay absent otherwise. The parent agent must already hold a grant.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag("agent", "string", "Agent id of the dispatched subagent."),
      requiredFlag("role", "string", "Canonical role the agent is granted."),
      requiredFlag("host", "string", "Host runtime that spawned the agent."),
      optionalFlag("parent-agent", "string", "Agent id that dispatched it; omit for the root."),
      optionalFlag(
        "parent-task",
        "string",
        "Task or branch sub-task the agent is dispatched onto.",
      ),
      optionalFlag("actor", "string", "Event actor; defaults to the parent agent, else the agent."),
      optionalFlag("provider", "string", "Host-reported provider serving the model."),
      optionalFlag(
        "model",
        "string",
        "Host-reported model id, recorded exactly as given and never parsed.",
      ),
      optionalFlag("model-tier", "string", "Host-reported tier: xs, s, m, l or unknown."),
      optionalFlag(
        "thinking-level",
        "string",
        "Host-reported level: low, medium, high or unknown.",
      ),
      optionalFlag("context-window", "int", "Host-reported context window in tokens."),
      toolFlag,
      toolExtraFlag,
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts agent:register --run .capsules/<run-id> --agent worker-1 --role implementer --host claude-code --parent-agent coordinator-1 --parent-task task-1 --tool Bash=shell --tool-extra Bash:shell=zsh",
    ],
    handler: agentRegisterCommand,
  },
  {
    name: "agent:report",
    aliases: [],
    domain: "agent",
    summary: "Ingest host-observed tool usage and token counts mid-flight.",
    description:
      "Token counts are the host's running totals and replace the previous ones; --tokens-estimated marks them derived estimates instead of measured counts. At least one of --tool, --tokens-in, --tokens-out or --token-extra is required.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag("agent", "string", "Agent id holding the grant."),
      toolFlag,
      toolExtraFlag,
      optionalFlag("tokens-in", "int", "Host-reported input tokens consumed so far."),
      optionalFlag("tokens-out", "int", "Host-reported output tokens produced so far."),
      {
        name: "token-extra",
        type: "string",
        required: false,
        repeatable: true,
        description:
          "One provider-specific counter as <name>=<count>, kept under the name the host reported it by.",
      },
      optionalFlag("tokens-estimated", "bool", "Record the counts as estimates, not measurements."),
      optionalFlag("actor", "string", "Event actor; defaults to the reporting agent."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts agent:report --run .capsules/<run-id> --agent worker-1 --tool Read=file-edit --tool Grep=search --tokens-in 18000 --tokens-out 2400 --token-extra cache_read_input_tokens=91000",
    ],
    handler: agentReportCommand,
  },
  {
    name: "agent:release",
    aliases: [],
    domain: "agent",
    summary: "Close a subagent's grant.",
    description:
      "Marks the grant released and stamps the release time. A released agent can no longer report.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag("agent", "string", "Agent id holding the grant."),
      optionalFlag("reason", "string", "Why the grant closed."),
      optionalFlag("actor", "string", "Event actor; defaults to the released agent."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      'bun harness.ts agent:release --run .capsules/<run-id> --agent worker-1 --reason "task-1 submitted"',
    ],
    handler: agentReleaseCommand,
  },
  {
    name: "agent:list",
    aliases: [],
    domain: "agent",
    summary: "Show who is deployed, or the lineage of one task.",
    description:
      "Without flags it lists active grants with their host-reported telemetry. --task answers who worked a task and under whom, including the agents those agents dispatched.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      optionalFlag("task", "string", "Report the lineage of this task instead of the roster."),
      optionalFlag("all", "bool", "Include released grants."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts agent:list --run .capsules/<run-id>",
      "bun harness.ts agent:list --run .capsules/<run-id> --task task-1",
    ],
    handler: agentListCommand,
  },
];
