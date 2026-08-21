import { cause, example, type ExplainEntry } from "./explain-data-types.ts";

export const INVALID_STATE_AND_ARGUMENT_ENTRIES: readonly ExplainEntry[] = [
  {
    code: "INVALID_STATE",
    summary:
      "The record the command names is not in the lifecycle position, ownership, or freshness it requires.",
    rule: "A task, branch, sub-task, lease, packet, plan/graph revision, agent grant, orphan-evidence record, or the run itself is not in the status, ownership, or freshness the command requires. The command targeted the right thing at the wrong moment.",
    causes: [
      cause(
        "lifecycle-status-precondition",
        "Record is not in the required status",
        "The task/branch/sub-task/run named by the command is not in the status the command requires - it must be validated, open, claimable, or uncompiled and is not.",
        "Check the record's current status (run:status, queue:list, branch:status) and issue the command at the right lifecycle point - the message names the status it wanted.",
        [
          example("workflow/gates/attach-result.ts", "task must be validated before gating"),
          example(
            "workflow/branch/sub-tasks.ts",
            "branch ${branch.id} is ${branch.status}, not open",
          ),
          example("workflow/lease/claim.ts", "task ${taskId} is not claimable"),
          example("cli/commands/plan.ts", "cannot add tasks to compiled plan"),
        ],
      ),
      cause(
        "lease-token-invalid-or-expired",
        "Lease token is stale, wrong, or frozen",
        "The lease token supplied does not match the live lease, the lease has expired, or its clock is suspended because a branch is open on it.",
        "Reclaim through task:claim / recover rather than reusing a stale token. If a branch is open on the task, branch:collect or branch:abandon it first - the lease clock is frozen until then.",
        [
          example("workflow/lease/release.ts", "lease identity or token is invalid"),
          example("workflow/lease/release.ts", "lease has expired"),
          example(
            "workflow/lease/heartbeat.ts",
            "lease clock is suspended while a branch is open; collect or abandon the branch first",
          ),
        ],
      ),
      cause(
        "missing-precursor-step",
        "A required earlier command was never run",
        "The command needs a plan compile, an agent registration, or a ready task that has not happened yet.",
        "Run the named precursor command first - the message states it explicitly (plan:compile, agent:register, and so on).",
        [
          example(
            "cli/commands/plan-replan.ts",
            "plan:replan requires a compiled plan; run plan:compile first",
          ),
          example(
            "cli/commands/gate-prove.ts",
            "task ${taskId} has no compiled task-scope gate to prove; run plan:compile first",
          ),
          example(
            "workflow/agents/ledger.ts",
            "agent ${agentId} holds no grant; register it with agent:register first",
          ),
          example("cli/commands/queue.ts", "no ready tasks available in queue to pop"),
        ],
      ),
      cause(
        "identity-or-independence-violation",
        "Acting agent fails an independence or grant check",
        "The acting agent authored the plan it is validating, implemented the task it is reviewing, or is invoking a command its role's contract does not grant.",
        "Dispatch a different agent id for the role that must stay independent, or check roles/<role>.md for the commands that role's grant actually permits.",
        [
          example(
            "workflow/plan-review/identity.ts",
            "plan validator must be independent from the coordinator or planner that produced the plan",
          ),
          example(
            "workflow/review/begin-validation.ts",
            "validator must be independent from implementers",
          ),
          example(
            "packets/command-authority.ts",
            'role ${role} may not invoke ${spec.name}: agent ${agentId} holds a ${role} grant, and the contract at ${resolveRoleContractPath(role)} grants only ${contract.commands.join(", ")}',
          ),
        ],
      ),
      cause(
        "concurrent-drift",
        "State drifted since this command's snapshot was taken",
        "The graph revision, repository bytes, or probe round changed between when this command's context was captured and when it tried to act on it.",
        "Something else committed a change (another agent, a replan) between the snapshot this command was reasoning about and now. Re-read current state and reissue the command.",
        [
          example(
            "workflow/plan-review/record-plan-review.ts",
            "graph revision has drifted since validation started",
          ),
          example(
            "workflow/completion/repository-binding.ts",
            "repository bytes changed after critic authorization",
          ),
          example("workflow/review/record-probe.ts", "probe round changed during the transaction"),
        ],
      ),
      cause(
        "budget-exhausted",
        "A configured budget or round limit is exhausted",
        "The run has hit max_agents, the completeness-critic round limit, or an event/state size limit configured for it.",
        "Raise the relevant key in harness.config.json (max_agents, completeness-critic rounds, event limits), or reduce the workload to fit inside the current budget - see references/configuration.md.",
        [
          example(
            "workflow/agents/ledger.ts",
            "max_agents budget of ${maxAgents} is exhausted: ${ledger.length} grants already issued and this needs ${additional} more; raise max_agents or narrow the work",
          ),
          example(
            "workflow/completion/begin-completeness-critic.ts",
            "completeness critic rounds are exhausted",
          ),
          example("store/event-append.ts", "event count exceeds configured limit"),
        ],
      ),
      cause(
        "verdict-evidence-incomplete",
        "A pass/completion is missing required evidence",
        "task:review --status pass, a gate finish, or a completion pass is blocked because a probe round, a gate, or an open finding has not been satisfied yet.",
        "Supply exactly what's named: run the missing task:probe round, or answer every open finding with --resolve <finding-id>=<command-id> before retrying task:review --status pass.",
        [
          example(
            "workflow/review/pass-preconditions.ts",
            "cannot pass ${task.id}: ${recorded} adversarial probe(s) recorded, ${minProbes} required; run task:probe first",
          ),
          example("workflow/gates/finish-task.ts", "task has open findings"),
          example(
            "cli/commands/review-resolutions.ts",
            'cannot pass ${taskId}: ${unanswered.length} open finding(s) unanswered: ${unanswered.join(", ")}; answer each with --resolve <finding-id>=<command-id>',
          ),
        ],
      ),
    ],
  },
  {
    code: "INVALID_ARGUMENT",
    summary:
      "The flags or payload supplied do not parse, do not fit the command's shape, or name something that does not exist.",
    rule: "The command was refused before anything in the capsule was read: the CLI's own argument layer rejected the invocation, a numeric or JSON payload failed its own shape/bounds check, an id named by a flag does not exist in this run, or the caller's stated intent broke an explicit business rule.",
    causes: [
      cause(
        "cli-flag-shape",
        "Flag itself is malformed",
        "An unknown flag was passed, a required flag is missing or blank, a flag needing a value got none, or a non-repeatable flag was repeated.",
        "Fix the invocation itself: spell the flag as the registry declares it (help <command>), give it a value, and don't repeat a non-repeatable flag.",
        [
          example("cli/options.ts", "unknown option: --${target}${hint}"),
          example("cli/options.ts", "--${name} must have a non-blank value"),
          example("cli/arguments.ts", "option --${name} requires a value"),
          example("cli/execute.ts", "--${missing.name} is required"),
        ],
      ),
      cause(
        "bounded-numeric-out-of-range",
        "Numeric value is outside its documented range",
        "lease_seconds, a validation window, or a byte/entry limit flag was given a value outside the bounds the command enforces.",
        "Supply a value inside the documented range; help <command> lists each flag's type, bounds and default.",
        [
          example(
            "workflow/branch/sub-tasks.ts",
            "lease_seconds must be an integer from 5 to 86400",
          ),
          example(
            "workflow/review/begin-validation.ts",
            "lease_seconds must be an integer from ${MIN_VALIDATION_WINDOW} to ${MAX_VALIDATION_WINDOW}",
          ),
          example("packets/repository-content-policy.ts", "${name} must be a positive integer"),
        ],
      ),
      cause(
        "unknown-reference-id",
        "A named id does not exist in this run",
        "A --task, --branch, or --requirement id was given that does not resolve against anything recorded in this run.",
        "The id doesn't exist in this run - check for a typo, or an id copied from a different or prior run (queue:list, run:status).",
        [
          example("workflow/task-state.ts", "unknown task: ${taskId}"),
          example("workflow/branch/ledger.ts", "unknown branch: ${branchId}"),
          example(
            "workflow/authority/record-authority-decision.ts",
            "unknown requirement: ${requirementId}",
          ),
        ],
      ),
      cause(
        "payload-schema-violation",
        "A JSON payload does not match its documented schema",
        "--report, --findings, --proofs, or --checklist-report was given a JSON payload missing a required field, carrying a wrong enum value, or duplicating an id.",
        "Fix the JSON payload to match the documented shape in references/schema-examples.md - a missing field, wrong enum value, or duplicate id is refused, never guessed at.",
        [
          example(
            "workflow/completion/parse-raw-findings.ts",
            "completion finding ${id} must declare severity critical, important or minor",
          ),
          example("workflow/submission/validate-report.ts", "report must be an object"),
          example(
            "workflow/review/validate-review.ts",
            'checklist coverage omits ${missing.length} item(s) of ${checklist.title}: ${missing.sort().join(", ")}',
          ),
        ],
      ),
      cause(
        "semantic-rule-on-caller-intent",
        "Request breaks an explicit business rule",
        "The caller's stated intent - an agent naming itself as its own parent, a repairer replacement equal to the original, a review verdict outside pass/reject, a dependency edge with no --dep-reason - is refused by name.",
        "The message names the exact rule the request broke; adjust the request to match it: a different --repairer, a --dep-reason on the edge, task:probe instead of a reject with no findings.",
        [
          example("workflow/agents/grants.ts", "an agent cannot be its own parent"),
          example(
            "workflow/review/assign-repairer.ts",
            "replacement must differ from original implementer",
          ),
          example(
            "workflow/review/validate-review.ts",
            "review verdict must be pass or reject; a probe is recorded with task:probe",
          ),
          example(
            "graph/topology-declaration.ts",
            "dependency edge(s) without a declared justification: ${listing}. Pass ",
          ),
        ],
      ),
      cause(
        "path-or-file-argument-invalid",
        "A path/file flag does not name a usable file",
        "--run does not name a real directory, or --report/--findings does not name a readable file of the expected kind.",
        "Point the flag at a real, readable path of the right kind - a directory for --run, a file for --report or a findings/proofs file.",
        [
          example("store/load.ts", "run_root must be a real directory: ${runRoot}"),
          example(
            "workflow/completion/parse-raw-findings.ts",
            "cannot read findings file: ${findingsFile}",
          ),
          example("store/blobs.ts", "not a regular file: ${sourcePath}"),
        ],
      ),
    ],
  },
];
