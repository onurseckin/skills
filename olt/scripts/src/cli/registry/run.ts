import { runCompleteCommand, runExecCommand, runStatusCommand } from "../commands/run-ops.ts";
import { runInitCommand } from "../commands/run-init.ts";
import { CATEGORY_FLAG_HELP } from "../taxonomy-flags.ts";
import {
  DEFAULT_EXIT_CODES,
  optionalFlag,
  requiredFlag,
  type CommandSpec,
  type ExitCodeSpec,
} from "./types.ts";

const EXEC_EXIT_CODES: readonly ExitCodeSpec[] = [
  { code: 0, meaning: "SUCCESS - the command ran; read exit_code for the child's own result" },
  ...DEFAULT_EXIT_CODES.slice(1),
];

export const RUN_COMMANDS: readonly CommandSpec[] = [
  {
    name: "run:init",
    aliases: [],
    domain: "run",
    summary: "Initialize a capsule run root and write its initial manifest.",
    description:
      "Deterministic auto-initialization ensuring .olt/capsules/<run_id>/ exists on disk before any subagent work.",
    flags: [
      requiredFlag("run", "string", "Capsule run root or run ID."),
      optionalFlag("run-id", "string", "Alias of --run."),
      optionalFlag("repo", "string", "Repository root.", "."),
      optionalFlag("prompt", "string", "Prompt string for run initialization."),
      optionalFlag("mode", "string", "Capsule mode (feature, bugfix, investigation, etc.)."),
      optionalFlag("actor", "string", "Agent or actor initializing the run."),
      optionalFlag("capture-mode", "string", "Capture mode (file, stdin, argv)."),
      optionalFlag("source-verified", "bool", "Whether source is verified."),
      optionalFlag("no-runtime-pin", "bool", "Do not pin runtime code."),
      optionalFlag("runtime-source", "string", "Runtime source directory to pin."),
      optionalFlag("allow-existing", "bool", "Allow initializing an already existing run.", true),
    ],
    readsStdin: true,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts run:init --run <run-id>"],
    handler: runInitCommand,
  },
  {
    name: "run:exec",
    aliases: [],
    domain: "run",
    summary: "Run a gate command under process isolation and record the evidence.",
    description:
      "Captures argv, cwd, timestamps, exit code and log bytes into the capsule, then ingests any screenshots, visual report and browser run metadata the command produced.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      optionalFlag("task", "string", "Task the command belongs to."),
      optionalFlag("gate", "string", "Gate id the command proves."),
      optionalFlag("cwd", "string", "Working directory; falls back to the repository root."),
      requiredFlag(
        "actor",
        "string",
        "Who is running the command. Recorded on the command and its event; there is no default actor.",
      ),
      optionalFlag("tool-category", "string", CATEGORY_FLAG_HELP),
      optionalFlag("tool", "string", "The tool this command invoked, named as you name it."),
      {
        name: "tool-extra",
        type: "string",
        required: false,
        repeatable: true,
        description:
          "One tool-specific fact about this command as <key>=<value>, kept verbatim under the reported name.",
      },
    ],
    readsStdin: false,
    takesRemainder: true,
    exitCodes: EXEC_EXIT_CODES,
    examples: [
      "bun harness.ts run:exec --run .olt/capsules/<run-id> --task task-1 --gate gate-1 --actor val-1 --tool-category test-runner --tool bun-test -- bun test tests/unit/auth.test.ts",
    ],
    handler: runExecCommand,
  },
  {
    name: "run:status",
    aliases: [],
    domain: "run",
    summary: "Show phase, per-task status and progress for the run.",
    description: "Reads the capsule without mutating it and renders the execution table.",
    flags: [
      optionalFlag(
        "run",
        "string",
        "Capsule run root. Defaults to current repository .olt/capsules/ when omitted.",
      ),
      optionalFlag("run-id", "string", "Alias of --run."),
      optionalFlag("repo", "string", "Repository root to search for .olt/capsules/.", "."),
      optionalFlag("detailed", "bool", "Include the raw state in the JSON result."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts run:status --run .olt/capsules/<run-id>"],
    handler: runStatusCommand,
  },
  {
    name: "run:complete",
    aliases: [],
    domain: "run",
    summary: "Seal the capsule after verifying every completion artifact.",
    description:
      "Re-verifies the recorded command evidence and the live repository binding, then commits terminal completion and regenerates the summary suite.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag(
        "actor",
        "string",
        "Who is completing the run. Recorded on the completion event; there is no default actor.",
      ),
      requiredFlag(
        "auth-token",
        "string",
        "The token critic:review handed back on approval; verified against the completeness critic's own record before the run can be sealed.",
      ),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts run:complete --run .olt/capsules/<run-id> --actor coordinator --auth-token <token-from-critic:review>",
    ],
    handler: runCompleteCommand,
  },
];
