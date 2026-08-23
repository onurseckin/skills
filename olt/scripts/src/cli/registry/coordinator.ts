import { coordinatorPushbackCommand } from "../commands/coordinator-pushback.ts";
import { DEFAULT_EXIT_CODES, requiredFlag, type CommandSpec } from "./types.ts";

export const COORDINATOR_COMMANDS: readonly CommandSpec[] = [
  {
    name: "coordinator:pushback",
    aliases: [],
    domain: "task",
    tier: "internal",
    internal: true,
    summary: "Reject a validator's own recorded pass, procedurally or substantively.",
    description:
      "QUEUE-6: the edge every pushback ran on was validator -> implementer; this is the missing " +
      "coordinator -> validator edge, for when the validator's OWN recorded pass does not hold up. " +
      "The task must currently be `validated` (every applicable domain passed, not yet finished) " +
      "and must carry a recorded pass from --validator in --domain, or this refuses. `--cause " +
      "procedural` means the review act itself did not meet the evidentiary bar (no evidence " +
      "recorded, a required check skipped) — the implementer's work is not in question, so the " +
      "task returns only to `validating` for a fresh, properly-evidenced review. `--cause " +
      "substantive` means the work itself is judged wrong despite the recorded pass — that carries " +
      "the same consequence a validator's own reject does: repair_round advances, the original " +
      "implementer is reassigned, and the task goes to `changes_requested` (or `escalated` once " +
      "repair rounds are exhausted). The disputed pass is archived into validation_history, never " +
      "silently dropped, and every pushback is recorded on the task under `coordinator_pushbacks` " +
      "with its cause, so a rejection for 'you did not record what you did' is expressible and " +
      "auditable, not just implied by a status change.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag("task", "string", "Task carrying the standing pass being contested."),
      requiredFlag(
        "actor",
        "string",
        "Coordinator agent id recorded as the author of this pushback.",
      ),
      requiredFlag("validator", "string", "Validator whose recorded pass is being pushed back on."),
      requiredFlag(
        "domain",
        "string",
        "Validator domain the disputed pass covers, e.g. ui-design.",
      ),
      requiredFlag(
        "cause",
        "string",
        "'procedural' (the review was not properly evidenced) or 'substantive' (the work itself is wrong).",
      ),
      requiredFlag("observation", "string", "What the coordinator found wrong with the pass."),
      requiredFlag("remediation", "string", "What must happen before this can pass again."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts coordinator:pushback --run .olt/capsules/<run-id> --task task-1 --actor coordinator " +
        '--validator val-1 --domain ui-design --cause procedural --observation "pass carried zero screenshot evidence" ' +
        '--remediation "re-run the visual suite and record real evidence before passing again"',
      "bun harness.ts coordinator:pushback --run .olt/capsules/<run-id> --task task-1 --actor coordinator " +
        '--validator val-1 --domain code-quality --cause substantive --observation "the recorded check output shows the gate never ran" ' +
        '--remediation "fix the gate invocation and resubmit"',
    ],
    handler: coordinatorPushbackCommand,
  },
];
