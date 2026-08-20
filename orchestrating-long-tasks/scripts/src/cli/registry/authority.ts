import { authorityDecideCommand } from "../commands/authority-ops.ts";
import { DEFAULT_EXIT_CODES, requiredFlag, type CommandSpec } from "./types.ts";

export const AUTHORITY_COMMANDS: readonly CommandSpec[] = [
  {
    name: "authority:decide",
    aliases: [],
    domain: "authority",
    summary: "Grant or decline a needs_authority requirement.",
    description:
      "A requirement disposed needs_authority holds every task built on it non-executable until this is recorded. Granting makes it actionable; declining disposes it out_of_scope and cancels every dormant task that depends on it alone, refusing instead if that would invalidate an active or completed one. The decision is permanent: a second call with the same actor and rationale is idempotent, any other call against an already-decided requirement is refused.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag("requirement", "string", "Requirement id, currently disposed needs_authority."),
      requiredFlag("actor", "string", "Who is making the decision."),
      requiredFlag("decision", "string", "grant or decline."),
      requiredFlag("rationale", "string", "Why this decision is correct."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      'bun harness.ts authority:decide --run .capsules/<run-id> --requirement req-prod-deploy --actor coordinator --decision grant --rationale "Human approved the production deploy in the review thread"',
    ],
    handler: authorityDecideCommand,
  },
];
