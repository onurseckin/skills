import {
  planAddCommand,
  planCompileCommand,
  planEnhanceCommand,
  planInitCommand,
  planReplanCommand,
  planStatusCommand,
} from "../commands/plan.ts";
import { planApplyCommand, planClaimCommand } from "../commands/plan-apply.ts";
import { planAuditCommand } from "../commands/plan-audit.ts";
import { planReviewCommand, planValidateStartCommand } from "../commands/plan-validate.ts";
import { orchestrateCommand } from "../commands/orchestrate.ts";
import { dagViewCommand } from "../commands/dag-view.ts";
import {
  DEFAULT_EXIT_CODES,
  optionalFlag,
  repeatableFlag,
  requiredFlag,
  type CommandSpec,
} from "./types.ts";

export const PLAN_COMMANDS: readonly CommandSpec[] = [
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
    aliases: ["init"],
    domain: "plan",
    summary: "Create a run capsule and capture the prompt bytes immutably.",
    description:
      "Initialises <repo>/.capsules/<run-id>, records the verbatim prompt with its sha256, and ensures the capsule is gitignored.",
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
      'bun harness.ts plan:enhance --run .capsules/<run-id> --actor planner --summary "Wire the drawer to the graph store" --todo "Add the state machine tab" --todo "Delete the legacy asset writes" --risk "Fixture dataset predates the new schema" --source src/graph/store.ts',
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
      'bun harness.ts plan:add --run .capsules/<run-id> --id task-1 --label "Database schema" --scope "src/db" --gate "bun test tests/db.test.ts" --actor coordinator',
      'bun harness.ts plan:add --run .capsules/<run-id> --id task-2 --label "CLI wiring" --scope "src/cli" --gate "bun test tests/unit/cli" --actor coordinator --requirement-lines "3-5"',
      'bun harness.ts plan:add --run .capsules/<run-id> --id task-3 --label "Integration" --scope "src/integration" --gate "bun test tests/integration" --actor coordinator --deps task-1,task-2 --dep-reason "task-1:reads the schema task-1 writes" --dep-reason "task-2:reads the CLI wiring task-2 writes"',
      'bun harness.ts plan:add --run .capsules/<run-id> --id task-topic --label "Topic bank" --actor coordinator --auto-partition "src/curriculum/mlQuestions/*.ts" --gate-template "bun test {scope}"',
    ],
    handler: planAddCommand,
  },
  {
    name: "plan:audit",
    aliases: [],
    domain: "plan",
    summary:
      "Audit the planning buffer against the six topology invariants and record the verdict.",
    description:
      "Runs A1-granularity, A3-gate-discrimination, A4-false-barrier, A5-straggler and A6-whole-suite-gate " +
      "against the current planning buffer and records the verdict as a plan-audited event, whatever the " +
      "outcome. A2-parallelism has no grounded entity count to compare against anywhere in this plan and " +
      "is reported under not_evaluated rather than guessed. plan:compile runs the same audit and refuses " +
      "to seal the plan on any blocking finding whose invariant was not accepted with --accept-audit; " +
      "this command lets a coordinator see the verdict before attempting a compile.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag("actor", "string", "Actor recorded on the event."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts plan:audit --run .capsules/<run-id> --actor planner"],
    handler: planAuditCommand,
  },
  {
    name: "plan:compile",
    aliases: [],
    domain: "plan",
    summary: "Compile the planning buffer into requirements, the DAG, and revision 1.",
    description:
      "Checks scope independence, derives requirements from the prompt lines, builds the graph, and commits graph revision 1. The mandatory run-completion gate is whatever --completion-gate declares; the compiler has no default for it and refuses to invent one. Also refuses to seal while any dependency edge in the buffer lacks the one-line justification `plan:add --dep-reason` records for it (C6's topology declaration) — the independent-root count and every justified edge are reported on the brief. Before any of that, runs plan:audit's six invariants and refuses to seal on any blocking finding: pass --accept-audit \"<invariant-id>:<reason>\" once per blocking invariant to record an explicit, attributed override and proceed anyway. There is no blanket override — every blocking invariant needs its own acceptance naming who accepted it and why.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag("actor", "string", "Actor recorded on the event."),
      requiredFlag(
        "completion-gate",
        "string",
        'Command the whole run is finally held to, e.g. "bun test tests/unit". Recorded as the mandatory run-scope gate; there is no default.',
      ),
      repeatableFlag(
        "accept-audit",
        "string",
        'Accept one blocking plan:audit invariant so compilation may proceed: "<invariant-id>:<reason>". ' +
          "Repeatable; every blocking invariant needs its own acceptance, and an invariant the audit did " +
          "not raise as blocking is refused rather than silently accepted. Never a blanket override.",
      ),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      'bun harness.ts plan:compile --run .capsules/<run-id> --actor planner --completion-gate "bun test tests/unit"',
      'bun harness.ts plan:compile --run .capsules/<run-id> --actor planner --completion-gate "bun test tests/unit" --accept-audit "A3-gate-discrimination:task-a and task-b legitimately share the shared-fixture regression test"',
    ],
    handler: planCompileCommand,
  },
  {
    name: "plan:validate-start",
    aliases: [],
    domain: "plan",
    summary: "Assign the plan-validator and mint the token required by plan:review.",
    description:
      "C2: opens the plan-validator's claim on the currently compiled plan (the projected tasks, requirements and gates at this graph revision, delivered via the packet) — one active assignment per graph revision, mirroring task:validate-start. The validator must be independent from the coordinator or planner that produced the plan. Dispatch this, and get a passing plan:review, before dispatching any implementer: a recorded plan:review --status changes_requested against the live graph revision is a hard stop that claimTask enforces directly, not a warning a coordinator can route around.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag("validator", "string", "Plan-validator agent id."),
      optionalFlag(
        "lease-duration",
        "int",
        "Seconds until the validation window expires (5-86400).",
        1_200,
      ),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts plan:validate-start --run .capsules/<run-id> --validator plan-val-1",
    ],
    handler: planValidateStartCommand,
  },
  {
    name: "plan:review",
    aliases: [],
    domain: "plan",
    summary: "Record the plan-validator's written verdict on the compiled plan.",
    description:
      "C2: --status approved clears the plan for implementer dispatch; changes_requested is the pushback — it records structured findings (each with id, severity, observation, remediation) and blocks every implementer and repairer claim against this graph revision until a fresh compile passes a new review. The four questions (--decomposition-answer, --dependency-answer, --gate-answer, --straggler-answer) are mandatory on every verdict, pass or reject: a rubber-stamped pass that never answered them is refused. Beyond prose, the verdict carries a mechanical floor: --dependency-edges-reviewed must name every dependency edge the compiled plan actually declares (exactly, not a subset) and --gate-ids-reviewed must name every per-task gate id in the plan (never the run-scoped completion gate, which is not a task gate) — omit a real one, or name one that does not exist, and the review is refused before it is recorded. changes_requested requires --findings or --findings-file; approved must carry none.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag("validator", "string", "Plan-validator agent id."),
      requiredFlag("token", "string", "Plan validation token."),
      requiredFlag("status", "string", "approved or changes_requested."),
      requiredFlag("summary", "string", "Verdict summary in the validator's own words."),
      requiredFlag(
        "decomposition-answer",
        "string",
        "Does the decomposition match the work's entity count, or did it compress?",
      ),
      requiredFlag(
        "dependency-answer",
        "string",
        "Is every dependency edge justified by a real read/write relationship?",
      ),
      requiredFlag(
        "gate-answer",
        "string",
        "Can each gate actually fail if its task does nothing?",
      ),
      requiredFlag(
        "straggler-answer",
        "string",
        "Will any task's scope make one agent straggle while the rest idle?",
      ),
      optionalFlag(
        "findings",
        "string",
        "Inline JSON findings payload (array of {id, severity, observation, remediation}).",
      ),
      optionalFlag("findings-file", "string", "Path to a JSON findings payload."),
      optionalFlag(
        "checks",
        "string",
        "Comma-separated command ids the validator ran as independent evidence.",
      ),
      optionalFlag(
        "dependency-edges-reviewed",
        "string",
        'Comma-separated "<from-task>:<to-task>" pairs — must name exactly the dependency edges the compiled plan declares, no more and no fewer. Empty when the plan declares none.',
      ),
      optionalFlag(
        "gate-ids-reviewed",
        "string",
        "Comma-separated gate ids — must name exactly the plan's per-task gate ids (never the run-scoped completion gate), no more and no fewer.",
      ),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      'bun harness.ts plan:review --run .capsules/<run-id> --validator plan-val-1 --token <token> --status approved --decomposition-answer "14 tasks match the 14 named topics" --dependency-answer "no dependency edges; every task is an independent root" --gate-answer "each gate runs only that task\'s own scoped test file" --straggler-answer "every task carries the same one-topic effort estimate" --gate-ids-reviewed "gate-1,gate-2,gate-3" --summary "Decomposition matches the prompt; gates are scope-narrow"',
      'bun harness.ts plan:review --run .capsules/<run-id> --validator plan-val-1 --token <token> --status changes_requested --decomposition-answer "10 topics compressed into 1 task" --dependency-answer "n/a" --gate-answer "the shared gate cannot fail per-task" --straggler-answer "n/a" --gate-ids-reviewed "gate-1" --summary "Compressed decomposition; see findings" --findings \'[{"id":"PV-1","invariant":"A2-parallelism","severity":"critical","observation":"10 distinct topics collapsed into task-domains","remediation":"one task per topic, each with its own scoped gate"}]\'',
    ],
    handler: planReviewCommand,
  },
  {
    name: "plan:replan",
    aliases: [],
    domain: "plan",
    summary: "Partition findings into a repair wave and raise the graph revision.",
    description:
      "Ingests validator or critic findings, partitions them into disjoint write scopes, and compiles the next revision.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag("actor", "string", "Actor recorded on the event."),
      optionalFlag("findings", "string", "Inline JSON findings payload."),
      optionalFlag("findings-file", "string", "Path to a JSON findings payload."),
      optionalFlag("round", "int", "Explicit repair round number."),
      optionalFlag(
        "gate",
        "string",
        "Revalidation gate for generated repair tasks. Omit only when the findings declare revalidation_gate or the planned task covering the scope has a gate to inherit; there is no default.",
      ),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      'bun harness.ts plan:replan --run .capsules/<run-id> --actor coordinator --gate "bun run typecheck"',
    ],
    handler: planReplanCommand,
  },
  {
    name: "plan:claim",
    aliases: [],
    domain: "plan",
    summary: "Issue a planner's role packet: the sole way a planner agent gets its contract.",
    description:
      "The planner has no task and no lease, so it cannot task:claim. This is its equivalent: it hands back the planner role contract, the immutable prompt, and the write scope (planning/requirements.json, planning/graph.json) the planner is bound to fill in before plan:apply. The packet's prescribed plan:apply command is pre-filled with --expected-revision at the run's live graph revision, so it succeeds on a run that has already compiled a graph, not only on a brand-new one.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag("agent", "string", "The planner's own agent id, already agent:register'd."),
      optionalFlag(
        "expected-revision",
        "int",
        "The graph revision the caller believes is live; the claim is refused if the run has moved past it. Omitted, the packet is issued at whatever revision is actually live.",
      ),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts plan:claim --run .capsules/<run-id> --agent planner-1"],
    handler: planClaimCommand,
  },
  {
    name: "plan:apply",
    aliases: [],
    domain: "plan",
    summary: "Validate and commit the requirements and graph the planner wrote to planning/.",
    description:
      "Reads requirements.json and graph.json (defaulting to planning/ inside the run), validates them against the immutable prompt, and commits them as the next graph revision. --expected-revision rejects the apply outright if the graph has moved since the planner's packet was issued, instead of silently overwriting a newer plan.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag("actor", "string", "Actor recorded on the event."),
      optionalFlag(
        "requirements",
        "string",
        "Path to the requirements document. Defaults to <run>/planning/requirements.json.",
      ),
      optionalFlag(
        "graph",
        "string",
        "Path to the graph document. Defaults to <run>/planning/graph.json.",
      ),
      optionalFlag(
        "expected-revision",
        "int",
        "The graph revision this apply must be built against; the apply is refused if the run has moved past it.",
      ),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts plan:apply --run .capsules/<run-id> --actor planner-1 --expected-revision 0",
    ],
    handler: planApplyCommand,
  },
  {
    name: "plan:status",
    aliases: [],
    domain: "plan",
    summary: "Show the planning buffer or the compiled plan summary.",
    description: "Reports every buffered task with its scope, gate and dependencies.",
    flags: [requiredFlag("run", "string", "Capsule run root.")],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts plan:status --run .capsules/<run-id>"],
    handler: planStatusCommand,
  },
  {
    name: "dag:view",
    aliases: ["graph:ascii", "status:dag"],
    domain: "plan",
    summary: "Render live ASCII execution DAG, active subagent allocations, and algorithmic parallelization recommendations.",
    description:
      "Inspects compiled graph or planning buffer DAG topology, computes critical path depth, tracks active subagent leases, and generates algorithmic parallelization recommendations.",
    flags: [
      optionalFlag(
        "run",
        "string",
        "Capsule run root. Defaults to current repository .capsules/ when omitted.",
      ),
      optionalFlag("run-id", "string", "Alias of --run."),
      optionalFlag("repo", "string", "Repository root to search for .capsules/.", "."),
      optionalFlag(
        "detailed",
        "bool",
        "Render full write scopes, gate commands, and dependency lists.",
      ),
      optionalFlag(
        "recommendations",
        "bool",
        "Highlight algorithmic parallelization opportunities.",
      ),
      optionalFlag("all", "bool", "Do not truncate output lines."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts dag:view --run .capsules/<run-id>",
      "bun harness.ts graph:ascii --run .capsules/<run-id> --detailed",
      "bun harness.ts dag:view --detailed --recommendations",
    ],
    handler: dagViewCommand,
  },
];
