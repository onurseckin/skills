import {
  planAddCommand,
  planEnhanceCommand,
  planInitCommand,
} from "../commands/plan.ts";
import { orchestrateCommand } from "../commands/orchestrate.ts";
import { planBrainstormCommand } from "../commands/plan-brainstorm.ts";
import { PLAN_LIFECYCLE_COMMANDS } from "./plan-lifecycle.ts";
import {
  DEFAULT_EXIT_CODES,
  optionalFlag,
  repeatableFlag,
  requiredFlag,
  type CommandSpec,
} from "./types.ts";

export const PLAN_AUTHORING_COMMANDS: readonly CommandSpec[] = [
  {
    name: "plan:brainstorm",
    aliases: [],
    domain: "plan",
    summary: "Expand a prompt against the 8 Socratic vectors across iterative rounds.",
    description:
      "Runs Socratic 8-vector brainstorming matrix expansion on prompt.md (or provided prompt), saving brainstorming.json and recording plan-brainstormed event.",
    flags: [
      optionalFlag("run", "string", "Capsule run root or run ID."),
      optionalFlag("run-id", "string", "Run id; interchangeable with --run."),
      optionalFlag("prompt", "string", "Verbatim prompt text override."),
      optionalFlag(
        "rounds",
        "int",
        "Number of iterative brainstorming rounds to execute (default: 3).",
        3,
      ),
      optionalFlag(
        "save",
        "bool",
        "Persist brainstorming.json to capsule root (default: true).",
        true,
      ),
      optionalFlag("actor", "string", "Actor recorded on the event.", "planner"),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts plan:brainstorm --run .olt/capsules/<run-id>",
      'bun harness.ts plan:brainstorm --prompt "Build a fault-tolerant distributed queue" --rounds 3',
    ],
    handler: (flags, context) => planBrainstormCommand(flags, context),
  },
  {
    name: "orchestrate",
    aliases: [],
    domain: "plan",
    summary: "The primary entry point: the user's entire prompt in, a running orchestration out.",
    description:
      "Takes the user's whole message as free text and captures it byte-for-byte as the immutable prompt (identical guarantee to plan:init), then opens the capsule. No flags to learn: everything typed after `orchestrate` is the prompt, and a piped stdin with no flags at all is read automatically (detected the way `cat`/`grep` do it, by checking whether stdin is actually a pipe, never by blocking an interactive terminal). --prompt-stdin and --prompt-file still work exactly as before, for a caller that wants to be explicit or that also needs --repo/--run alongside a real file or pipe. A registered flag such as --repo or --run typed AFTER the inline free text is refused rather than folded into the prompt, so it can never silently lose its effect or pollute the captured bytes — use --prompt-file or piped stdin instead of mixing flags into inline text. Returns the fixed checklist for what happens next — plan:enhance, plan:add, plan:compile, queue:wave — bound to the run it just opened, so the calling agent never has to assemble that sequence by hand. It cannot run plan:enhance itself: reading the repository and deciding what the run is actually about needs a model's judgment, and the harness never calls one. --run is optional; omitted, a run id is derived from today's date and the first few words of the prompt.",
    flags: [
      optionalFlag("repo", "string", "Repository root that owns the capsule.", "."),
      optionalFlag(
        "run",
        "string",
        "Run id; interchangeable with --run-id. Derived from the prompt when omitted.",
      ),
      optionalFlag(
        "run-id",
        "string",
        "Run id; interchangeable with --run. Derived from the prompt when omitted.",
      ),
      optionalFlag("prompt-file", "string", "File holding the verbatim prompt bytes."),
      optionalFlag(
        "prompt-stdin",
        "bool",
        "Read the verbatim prompt bytes from stdin explicitly. Not required for a real pipe: a " +
          "bare `orchestrate` with nothing else after it already reads stdin when it is not an " +
          "interactive terminal. This flag exists for a caller that wants the read to fail loudly " +
          "instead of silently falling through when stdin turns out not to be piped.",
      ),
      optionalFlag(
        "capture-mode",
        "string",
        "How the prompt was captured; defaults to argv, file or stdin, whichever was actually used.",
      ),
      optionalFlag(
        "source-verified",
        "bool",
        "Assert the prompt source was verified by the caller.",
      ),
      optionalFlag(
        "runtime-source",
        "string",
        "Directory to pin as this run's runtime, verified and copied into runtime/. Defaults to the directory containing the currently running harness.ts.",
      ),
      optionalFlag(
        "no-runtime-pin",
        "bool",
        "Skip pinning a runtime even when one is available by default.",
      ),
    ],
    readsStdin: true,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts orchestrate Add a slugify helper that lowercases text and collapses punctuation.",
      'printf "%s" "$PROMPT" | bun harness.ts orchestrate',
      "bun harness.ts orchestrate --repo . --run my-feature --prompt-file prompt.txt",
    ],
    handler: orchestrateCommand,
  },
  {
    name: "plan:init",
    aliases: [],
    domain: "plan",
    summary: "Create a run capsule and capture the prompt bytes immutably.",
    description:
      "Initialises <repo>/.olt/capsules/<run-id>, records the verbatim prompt with its sha256, and ensures the capsule is gitignored.",
    flags: [
      optionalFlag("run", "string", "Run id; interchangeable with --run-id."),
      optionalFlag("run-id", "string", "Run id; interchangeable with --run."),
      optionalFlag("repo", "string", "Repository root that owns the capsule.", "."),
      optionalFlag("prompt-file", "string", "File holding the verbatim prompt bytes."),
      optionalFlag("prompt-stdin", "bool", "Read the verbatim prompt bytes from stdin."),
      optionalFlag(
        "capture-mode",
        "string",
        "How the prompt was captured; defaults to the source used.",
      ),
      optionalFlag(
        "source-verified",
        "bool",
        "Assert the prompt source was verified by the caller.",
      ),
      optionalFlag(
        "runtime-source",
        "string",
        "Directory to pin as this run's runtime, verified and copied into runtime/. Defaults to the directory containing the currently running harness.ts.",
      ),
      optionalFlag(
        "no-runtime-pin",
        "bool",
        "Skip pinning a runtime even when one is available by default.",
      ),
    ],
    readsStdin: true,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      'printf "%s" "$PROMPT" | bun harness.ts plan:init --repo . --run <run-id> --prompt-stdin',
      "bun harness.ts plan:init --repo . --run-id <run-id> --prompt-file prompt.txt --capture-mode file",
    ],
    handler: planInitCommand,
  },
  {
    name: "plan:enhance",
    aliases: [],
    domain: "plan",
    summary: "Record the agent's reading of the repository as a reviewable plan document.",
    description:
      "Writes planning/enhanced-plan.md and planning/enhanced-plan.json read-only and records their digests in state.planning.enhanced_plan. The agent reads the repository host-side and reports what it found; the harness asks no model anything and invents no entry, so everything recorded carries evidence_class agent_reported. The document is derived: prompt.md stays the requirement source. Needs at least one of --summary, --observation, --todo, --risk or --open-question.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag("actor", "string", "Actor recorded on the event."),
      optionalFlag("summary", "string", "The enhanced brief: what this run is actually about."),
      repeatableFlag("observation", "string", "Something the agent found in the repository."),
      repeatableFlag("todo", "string", "One organised to-do item, in the order to do it."),
      repeatableFlag("risk", "string", "A risk the agent identified."),
      repeatableFlag("open-question", "string", "A question the agent could not answer."),
      repeatableFlag("source", "string", "A file the agent actually read."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      'bun harness.ts plan:enhance --run .olt/capsules/<run-id> --actor planner --summary "Wire the drawer to the graph store" --todo "Add the state machine tab" --todo "Delete the legacy asset writes" --risk "Fixture dataset predates the new schema" --source src/graph/store.ts',
    ],
    handler: planEnhanceCommand,
  },
  {
    name: "plan:add",
    aliases: [],
    domain: "plan",
    summary: "Register a task declaration in the planning buffer.",
    description:
      "Appends one task to the uncompiled planning buffer. Rejected once the plan has been compiled. " +
      "--scope and --gate are required for a single task declaration; omit both and pass " +
      "--auto-partition instead to have the harness enumerate a glob on disk and register one task " +
      "per match (or per --group-by directory) in one call, each with its own gate derived from " +
      "--gate-template. Every declared --deps id needs a matching --dep-reason before plan:compile " +
      "will seal the plan (C6's mandatory edge justification).",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag(
        "id",
        "string",
        "Task id, unique within the buffer. In --auto-partition mode this is the id prefix every generated task id is built from.",
      ),
      requiredFlag(
        "label",
        "string",
        "Human label for the task. In --auto-partition mode this is the label prefix for every generated task.",
      ),
      optionalFlag(
        "scope",
        "string",
        "Comma-separated write scope paths. Required unless --auto-partition is set; refused together with it.",
      ),
      optionalFlag(
        "gate",
        "string",
        "Verification command that proves the task. Required unless --auto-partition is set; refused together with it.",
      ),
      requiredFlag("actor", "string", "Actor recorded on the event."),
      optionalFlag(
        "deps",
        "string",
        "Comma-separated ids this task depends on. Refused together with --auto-partition.",
      ),
      repeatableFlag(
        "dep-reason",
        "string",
        'One dependency\'s justification as "<dep-id>:<why this edge exists>". plan:compile refuses to seal while any --deps id lacks a matching --dep-reason. Refused together with --auto-partition.',
      ),
      optionalFlag("goal", "string", "Goal statement for the task."),
      optionalFlag("criteria", "string", "Semicolon-separated acceptance criteria."),
      optionalFlag("priority", "int", "Scheduling priority; higher runs earlier."),
      optionalFlag("effort", "int", "Relative effort estimate."),
      optionalFlag(
        "requirement-lines",
        "string",
        'Prompt lines this task implements, e.g. "3-5,8". Without it the compiler glues the task to a prompt line by position and warns.',
      ),
      optionalFlag(
        "auto-partition",
        "string",
        "A glob the harness enumerates on disk (relative to the repository root); emits one task per matched file, or per --group-by directory. Mutually exclusive with --scope, --gate, --deps and --dep-reason.",
      ),
      optionalFlag(
        "gate-template",
        "string",
        "Command template for --auto-partition; must contain the literal placeholder {scope}, substituted per generated task with that task's own file or directory path. Required together with --auto-partition.",
      ),
      optionalFlag(
        "group-by",
        "string",
        "file (default) or directory: whether --auto-partition emits one task per matched file or one task per directory holding matches.",
        "file",
      ),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      'bun harness.ts plan:add --run .olt/capsules/<run-id> --id task-1 --label "Database schema" --scope "src/db" --gate "bun test tests/db.test.ts" --actor coordinator',
      'bun harness.ts plan:add --run .olt/capsules/<run-id> --id task-2 --label "CLI wiring" --scope "src/cli" --gate "bun test tests/unit/cli" --actor coordinator --requirement-lines "3-5"',
      'bun harness.ts plan:add --run .olt/capsules/<run-id> --id task-3 --label "Integration" --scope "src/integration" --gate "bun test tests/integration" --actor coordinator --deps task-1,task-2 --dep-reason "task-1:reads the schema task-1 writes" --dep-reason "task-2:reads the CLI wiring task-2 writes"',
      'bun harness.ts plan:add --run .olt/capsules/<run-id> --id task-topic --label "Topic bank" --actor coordinator --auto-partition "src/curriculum/mlQuestions/*.ts" --gate-template "bun test {scope}"',
    ],
    handler: planAddCommand,
  },
];

export const PLAN_COMMANDS: readonly CommandSpec[] = [
  ...PLAN_AUTHORING_COMMANDS,
  ...PLAN_LIFECYCLE_COMMANDS,
];
