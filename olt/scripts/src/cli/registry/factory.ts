import {
  factoryPreplanCommand,
  factoryStatusCommand,
} from "../commands/factory-ops.ts";
import {
  DEFAULT_EXIT_CODES,
  optionalFlag,
  type CommandSpec,
} from "./types.ts";

export { factoryPreplanCommand, factoryStatusCommand };

export const FACTORY_COMMANDS: readonly CommandSpec[] = [
  {
    name: "factory:preplan",
    aliases: ["mind:preplan", "preplan:run"],
    domain: "mind",
    summary: "Execute continuous pre-planning factory tick to cluster backlog and emit blueprints.",
    description:
      "Scans .olt/backlog.jsonl and .olt/defects.jsonl, groups eligible items into thematic domain clusters, writes Phase 1 master plan blueprints, and updates bridge states under flock protection.",
    flags: [
      optionalFlag("repo", "string", "Repository root path."),
      optionalFlag("root", "string", "Alias for --repo."),
      optionalFlag(
        "dry-run",
        "bool",
        "Simulate clustering and blueprint generation without disk mutations.",
      ),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts factory:preplan",
      "bun harness.ts factory:preplan --dry-run",
      "bun harness.ts factory:preplan --repo .",
    ],
    handler: factoryPreplanCommand,
  },
  {
    name: "factory:status",
    aliases: ["mind:factory:status", "preplan:status"],
    domain: "mind",
    summary:
      "Inspect factory pre-planning queue health, stagnation status, and concurrency saturation.",
    description:
      "Audits the pre-planning backlog queue against stagnation thresholds, evaluates skill concurrency saturation, and reports readiness for blueprint assembly.",
    flags: [
      optionalFlag("repo", "string", "Repository root path."),
      optionalFlag("root", "string", "Alias for --repo."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts factory:status",
      "bun harness.ts factory:status --repo .",
    ],
    handler: factoryStatusCommand,
  },
];
