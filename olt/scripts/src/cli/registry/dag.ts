import type { CommandSpec } from "./types.ts";
import { DEFAULT_EXIT_CODES, optionalFlag } from "./types.ts";
import { dagCheckCommand, dagHealCommand } from "../commands/dag-ops/index.ts";

export { dagCheckCommand, dagHealCommand };

export const DAG_COMMANDS: readonly CommandSpec[] = [
  {
    name: "dag:check",
    aliases: [],
    domain: "plan",
    summary:
      "Tarjan SCC cycle detection, scope overlap audits, Brent work/span analysis, and serialization edge audits.",
    description:
      "Audits the DAG structure using Tarjan SCC for cycle detection, evaluates scope overlap conflicts across concurrent tasks, computes Brent work/span metrics (P = ceil(W/S)), and flags artificial serialization edges.",
    flags: [
      optionalFlag(
        "run",
        "string",
        "Capsule run root. Defaults to current repository .olt/capsules/ when omitted.",
      ),
      optionalFlag("run-id", "string", "Alias of --run."),
      optionalFlag("repo", "string", "Repository root to search for .olt/capsules/.", "."),
      optionalFlag(
        "detailed",
        "bool",
        "Detailed audit outputs including cycle paths and scope conflict details.",
      ),
      optionalFlag("json", "bool", "Output structured JSON report."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts dag:check",
      "bun harness.ts dag:check --run .olt/capsules/<run-id>",
      "bun harness.ts dag:check --detailed",
    ],
    handler: dagCheckCommand,
  },
  {
    name: "dag:heal",
    aliases: [],
    domain: "plan",
    summary:
      "Dynamic wave decoupling, dependency healing, automated feedback arc set cycle recovery under flock protection.",
    description:
      "Recovers corrupted or cyclic DAGs under exclusive flock protection: prunes or inverts feedback back-edges, removes dangling or self-referential dependencies, and computes safe decoupled topological execution waves.",
    flags: [
      optionalFlag(
        "run",
        "string",
        "Capsule run root. Defaults to current repository .olt/capsules/ when omitted.",
      ),
      optionalFlag("run-id", "string", "Alias of --run."),
      optionalFlag("repo", "string", "Repository root to search for .olt/capsules/.", "."),
      optionalFlag("mode", "string", "Healing mode: prune or invert (default: prune).", "prune"),
      optionalFlag("dry-run", "bool", "Simulate DAG healing without modifying state.", false),
      optionalFlag("json", "bool", "Output structured JSON report."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts dag:heal",
      "bun harness.ts dag:heal --run .olt/capsules/<run-id>",
      "bun harness.ts dag:heal --mode invert",
    ],
    handler: dagHealCommand,
  },
];
