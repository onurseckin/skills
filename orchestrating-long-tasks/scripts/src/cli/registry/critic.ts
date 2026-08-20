import {
  criticRejectCommand,
  criticRemediateCommand,
  criticReviewCommand,
  criticStartCommand,
} from "../commands/critic-ops.ts";
import {
  DEFAULT_EXIT_CODES,
  optionalFlag,
  repeatableFlag,
  requiredFlag,
  type CommandSpec,
} from "./types.ts";

export const CRITIC_COMMANDS: readonly CommandSpec[] = [
  {
    name: "critic:start",
    aliases: [],
    domain: "critic",
    summary: "Authorise a completeness critic against the immutable prompt bytes.",
    description:
      "Records a repository inspection, assigns the critic, and returns the critic token required to review.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag("critic", "string", "Critic agent id."),
      optionalFlag("repository-command-ids", "string", "Command ids that bound the repository."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts critic:start --run .capsules/<run-id> --critic critic-1"],
    handler: criticStartCommand,
  },
  {
    name: "critic:review",
    aliases: [],
    domain: "critic",
    summary: "Record the completeness verdict over the whole repository diff.",
    description:
      "--decision approve clears completion; request_changes records findings that block it and requires --findings or --findings-file, because the harness never composes a finding on the critic's behalf. Every finding must carry id, requirement_id, severity, observation, remediation and revalidation. Requirement proofs come only from --proofs/--proofs-file or --review; a requirement with no proof is recorded unproven and blocks completion, and a clean verdict with any unproven requirement is refused. integrity_evidence is always the harness's own capsule integrity observation, measured at review time; a --review file cannot certify its own capsule, so whatever it declares under that key is replaced.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag("critic", "string", "Critic agent id."),
      requiredFlag("token", "string", "Critic token."),
      requiredFlag("decision", "string", "approve or request_changes."),
      requiredFlag("summary", "string", "Verdict summary in the critic's own words."),
      optionalFlag("findings", "string", "Inline JSON findings payload."),
      optionalFlag("findings-file", "string", "Path to a JSON findings payload."),
      optionalFlag("proofs", "string", "Inline JSON requirement_proofs payload."),
      optionalFlag("proofs-file", "string", "Path to a JSON requirement_proofs payload."),
      optionalFlag("review", "string", "Path to a complete review payload."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      'bun harness.ts critic:review --run .capsules/<run-id> --critic critic-1 --token <token> --decision approve --proofs-file proofs.json --summary "Whole diff verified"',
    ],
    handler: criticReviewCommand,
  },
  {
    name: "critic:reject",
    aliases: [],
    domain: "critic",
    summary: "Reject completion with findings that trigger replanning.",
    description:
      "Equivalent to critic:review --decision request_changes with a rejection brief. Structured findings are mandatory: pass --findings or --findings-file.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag("critic", "string", "Critic agent id."),
      requiredFlag("token", "string", "Critic token."),
      requiredFlag("summary", "string", "Rejection summary in the critic's own words."),
      optionalFlag("findings", "string", "Inline JSON findings payload."),
      optionalFlag("findings-file", "string", "Path to a JSON findings payload."),
      optionalFlag("proofs", "string", "Inline JSON requirement_proofs payload."),
      optionalFlag("proofs-file", "string", "Path to a JSON requirement_proofs payload."),
      optionalFlag("review", "string", "Path to a complete review payload."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      'bun harness.ts critic:reject --run .capsules/<run-id> --critic critic-1 --token <token> --summary "Missing error boundary" --findings \'[{"id":"F-01","requirement_id":"req-1","severity":"critical","observation":"No error boundary around the render tree","remediation":"Wrap the tree in an error boundary","revalidation":"bun test tests/render"}]\'',
    ],
    handler: criticRejectCommand,
  },
  {
    name: "critic:remediate",
    aliases: [],
    domain: "critic",
    summary: "Close out a critic findings review with command-backed remediation evidence.",
    description:
      "Every review recorded with status findings stays in history and blocks completion until it carries a remediation naming exactly its own finding ids, each proven by a critic-run, task-unbound, successful command. --resolve is repeatable as <finding-id>=<command-id>[,<command-id>]; --resolution-method names how each finding was closed. --review-sha256 defaults to the currently recorded review.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag("actor", "string", "Who is recording the remediation."),
      optionalFlag("review-sha256", "string", "Digest of the review being remediated."),
      repeatableFlag(
        "resolve",
        "string",
        "Answer a finding: <finding-id>=<command-id>[,<command-id>].",
      ),
      repeatableFlag("resolution-method", "string", "How a finding was answered: <finding-id>=<method>."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      'bun harness.ts critic:remediate --run .capsules/<run-id> --actor coordinator --resolve CF-1=C-fix-1 --resolution-method CF-1="focused repair and verification"',
    ],
    handler: criticRemediateCommand,
  },
];
