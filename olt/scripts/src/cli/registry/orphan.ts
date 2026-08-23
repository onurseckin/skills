import { orphanDisposeCommand } from "../commands/orphan-ops.ts";
import { DEFAULT_EXIT_CODES, repeatableFlag, requiredFlag, type CommandSpec } from "./types.ts";

export const ORPHAN_COMMANDS: readonly CommandSpec[] = [
  {
    name: "orphan:dispose",
    aliases: [],
    domain: "orphan",
    summary: "Close out a command record that arrived without a live owner.",
    description:
      "Orphan evidence — typically a durable command record left behind by an agent that died mid-run — blocks completion until it is explicitly dispositioned. --disposition is ignored_non_authoritative, rejected, or superseded; there is no default, and each disposition is terminal.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag("actor", "string", "Who is recording the disposition."),
      requiredFlag(
        "orphan-sha256",
        "string",
        "Digest of the orphan evidence, from doctor's issues.",
      ),
      requiredFlag("disposition", "string", "ignored_non_authoritative, rejected, or superseded."),
      requiredFlag("rationale", "string", "Why this disposition is correct."),
      repeatableFlag("evidence", "string", "Command id supporting the disposition; repeat per id."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      'bun harness.ts orphan:dispose --run .olt/capsules/<run-id> --actor coordinator --orphan-sha256 <sha> --disposition ignored_non_authoritative --rationale "agent worker-3 died before submitting; the command it ran is not authoritative for any task" --evidence C-abc123',
    ],
    handler: orphanDisposeCommand,
  },
];
