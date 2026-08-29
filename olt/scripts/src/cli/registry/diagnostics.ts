import { defectAuditCommand } from "../commands/defect-audit.ts";
import { coverageCheckCommand } from "../commands/coverage-check.ts";
import {
  doctorCommand,
  healthCommand,
  recoverCommand,
  repairProjectionCommand,
} from "../commands/diagnostics-ops.ts";
import { doctorCertifyCommand } from "../../reporting/doctor/certify-command.ts";
import { findingFileCommand } from "../commands/finding-ops.ts";
import {
  DEFAULT_EXIT_CODES,
  optionalFlag,
  repeatableFlag,
  requiredFlag,
  type CommandSpec,
} from "./types.ts";

export const DIAGNOSTICS_COMMANDS: readonly CommandSpec[] = [
  {
    name: "defect:audit",
    aliases: [],
    domain: "diagnostics",
    tier: "internal",
    internal: true,
    summary: "Audit, deduplicate, and auto-admit defects across capsules.",
    description:
      "Discovers defects.jsonl files across .olt/capsules/ and active run, deduplicates entries, displays an ASCII summary matrix, and optionally auto-admits candidate remediations.",
    flags: [
      optionalFlag("run", "string", "Capsule run root."),
      optionalFlag("capsules-dir", "string", "Capsules root directory."),
      optionalFlag("filter-status", "string", "Filter by status: open, admitted, resolved, all."),
      optionalFlag("filter-category", "string", "Filter by defect category/type."),
      optionalFlag("filter-type", "string", "Alias for --filter-category."),
      optionalFlag("auto-admit", "bool", "Automatically admit open defects as candidates."),
      optionalFlag("actor", "string", "Actor recording admissions."),
      optionalFlag("all", "bool", "Show all defects without line truncation."),
      optionalFlag("now", "string", "Timestamp override (ISO8601)."),
      optionalFlag("json", "bool", "Output JSON."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts defect:audit",
      "bun harness.ts defect:audit --run .olt/capsules/<run-id> --filter-status open",
      "bun harness.ts defect:audit --auto-admit --actor coordinator",
    ],
    handler: defectAuditCommand,
  },
  {
    name: "coverage:check",
    aliases: [],
    domain: "diagnostics",
    tier: "internal",
    internal: true,
    summary: "Audit repository test coverage against strict 95% threshold.",
    description:
      "Runs bun test with coverage collection, parses per-file metrics across lines, statements, functions, and branches, and enforces the minimum 95% threshold.",
    flags: [
      optionalFlag(
        "threshold",
        "string",
        "Minimum coverage threshold fraction, default 0.95.",
        "0.95",
      ),
      optionalFlag("dir", "string", "Target repository directory to run coverage check in."),
      optionalFlag("strict", "bool", "Exit nonzero when coverage is below threshold."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts coverage:check",
      "bun harness.ts coverage:check --threshold 0.95 --strict",
    ],
    handler: coverageCheckCommand,
  },
  {
    name: "health",
    aliases: [],
    domain: "diagnostics",
    tier: "internal",
    internal: true,
    summary: "Check whether the code still does what the requirements said.",
    description:
      "Reports unused exports and unreachable modules, dead or superseded code, declared behaviour nothing enforces, requirements with no code or no test, literal fallbacks that substitute a plausible value for a missing one, and vendor names in identifier positions. Every check prints what it cannot see. Unlike `doctor` it reads a source tree, not a capsule.",
    flags: [
      optionalFlag(
        "scripts",
        "string",
        "Harness scripts root to inspect. Defaults to the running harness.",
      ),
      optionalFlag(
        "consumer",
        "string",
        "Consumer repository root. Without it the vendor-name sweep covers one repo, and says so.",
      ),
      repeatableFlag("check", "string", "Restrict the run to named checks."),
      optionalFlag(
        "all",
        "bool",
        "List every failure instead of the first five per check, and every advisory alongside them.",
      ),
      optionalFlag("strict", "bool", "Exit nonzero when the report is unhealthy."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts health",
      "bun harness.ts health --consumer ../gvui --all",
      "bun harness.ts health --check unused-code --strict",
    ],
    handler: healthCommand,
  },
  {
    name: "doctor",
    aliases: [],
    domain: "diagnostics",
    tier: "primary",
    internal: false,
    summary: "Verify capsule integrity, command evidence and the runtime.",
    description:
      "Re-hashes the event chain, re-verifies every recorded command, reports workflow blockers and, with --source and --home, the installation state.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      optionalFlag("source", "string", "Skill source directory for the installation check."),
      optionalFlag("home", "string", "Home directory for the installation check."),
      optionalFlag("clients", "string", "Comma-separated clients for the installation check."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts doctor --run .olt/capsules/<run-id>"],
    handler: doctorCommand,
  },
  {
    name: "doctor:repair",
    aliases: [],
    domain: "diagnostics",
    tier: "primary",
    internal: false,
    summary: "Re-derive state.json from the event chain after a crash tears the log's tail.",
    description:
      "The repair counterpart to `doctor`: `doctor` only reports a torn tail or a state/event mismatch. This re-derives state.json from the event chain's last complete event, quarantining any torn final fragment under quarantine/ instead of discarding it, and records a projection-recovered event. Refuses if the manifest or prompt itself is corrupt - that is an integrity failure, not something to repair silently.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag(
        "actor",
        "string",
        "Who is running the repair. Recorded on the event; there is no default actor.",
      ),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts doctor:repair --run .olt/capsules/<run-id> --actor coordinator"],
    handler: repairProjectionCommand,
  },
  {
    name: "doctor:certify",
    aliases: [],
    domain: "diagnostics",
    tier: "internal",
    internal: true,
    summary: "Certify doctor's own checks are falsifiable via counterfactual mutation testing.",
    description:
      "Runs the full harness health diagnostic suite (bun version, capsule root confinement, unified evidence location, tier confinement, integrity) that `doctor` folds into every run, plus -- for each --write-scope test file -- an adversarial counterfactual check: it mutates the file (flips an assertion, injects a syntax error, etc.), reruns it, and verifies the mutation actually makes it fail, proving the gate is falsifiable rather than vacuous, then reverts the mutation. Slower than `doctor` and gated behind this explicit command because it mutates files and runs real test commands. Each --write-scope path must be a .test.ts or .spec.ts file; anything else is rejected up front rather than silently skipped.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      repeatableFlag(
        "write-scope",
        "string",
        "A .test.ts or .spec.ts file to adversarially mutate and verify falsifiability for. Omit to run only the non-adversarial health diagnostics.",
      ),
      optionalFlag(
        "mutation-kind",
        "string",
        "syntax_error | assertion_flip | return_override | empty_file | exception_injection. Defaults to syntax_error.",
      ),
      optionalFlag("strict", "bool", "Exit nonzero when the report is not certified."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts doctor:certify --run .olt/capsules/<run-id>",
      "bun harness.ts doctor:certify --run .olt/capsules/<run-id> --write-scope tests/unit/doctor/capsule-root.test.ts --strict",
    ],
    handler: doctorCertifyCommand,
  },
  {
    name: "recover",
    aliases: [],
    domain: "diagnostics",
    tier: "internal",
    internal: true,
    summary: "Release expired leases and interrupted validations.",
    description:
      "Returns tasks whose lease expired to retry_ready (or changes_requested after a repair attempt), reopens interrupted validations, reclaims branch sub-tasks whose sub-agent died, and expires a stale completeness critic. A branched parent's frozen lease is never reaped: it is blocked on children, not gone.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      requiredFlag(
        "actor",
        "string",
        "Who is running the recovery. Recorded on the event; there is no default actor.",
      ),
      optionalFlag("grace-seconds", "int", "Grace period past expiry, 0-86400.", 30),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: ["bun harness.ts recover --run .olt/capsules/<run-id> --actor coordinator"],
    handler: recoverCommand,
  },
  {
    name: "meta-audit",
    aliases: [],
    domain: "diagnostics",
    tier: "internal",
    internal: true,
    summary: "Deep behavioral forensics and anomaly detection across all agent telemetry.",
    description:
      "Evaluates raw execution traces against 7 behavioral heuristics (TOKEN_BURNING, FALSE_SERIALIZATION, etc.), computes efficiency scores, and injects autonomous remediation proposals.",
    flags: [
      requiredFlag("run", "string", "Capsule run root."),
      optionalFlag("format", "string", "Output format."),
      optionalFlag("inject", "bool", "Inject remediation proposals."),
      optionalFlag("agent", "string", "Agent ID to filter."),
      requiredFlag("actor", "string", "Acting coordinator or meta-auditor authorizing injection."),
      optionalFlag("verbose", "bool", "Verbose output."),
      optionalFlag("json", "bool", "Output JSON."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts meta-audit --run .olt/capsules/<run-id> --actor coordinator --inject",
    ],
    handler: async (flags, context, remainder) => {
      const { metaAuditCommand } = await import("../commands/meta-audit.ts");
      return (await metaAuditCommand(flags, context)) as unknown as Record<string, unknown>;
    },
  },
  {
    name: "finding:file",
    aliases: [],
    domain: "diagnostics",
    tier: "primary",
    internal: false,
    summary: "Record a diagnostic finding or defect directly into the flock-locked defect store.",
    description:
      "Universal diagnostic finding ingestion command accessible to all companion and auditor roles. Appends or updates defects in .olt/defects.jsonl under flock lock.",
    flags: [
      requiredFlag("code", "string", "Diagnostic finding code (e.g. AST_PURITY_VIOLATION)."),
      optionalFlag("severity", "string", "Severity: critical, high, warning, low, info."),
      optionalFlag("file", "string", "Target file path where violation occurred."),
      optionalFlag("path", "string", "Alias for --file."),
      optionalFlag("line", "int", "Line number where violation occurred."),
      optionalFlag("message", "string", "Diagnostic message or description."),
      optionalFlag("description", "string", "Alias for --message."),
      optionalFlag("task-id", "string", "Task identifier during which finding occurred."),
      optionalFlag("commit-sha", "string", "Commit SHA where finding was observed."),
      optionalFlag("remediation", "string", "Remediation guidance."),
      optionalFlag("actor", "string", "Actor recording the finding."),
      optionalFlag("defects-path", "string", "Custom defects.jsonl file location."),
    ],
    readsStdin: false,
    takesRemainder: false,
    exitCodes: DEFAULT_EXIT_CODES,
    examples: [
      "bun harness.ts finding:file --code AST_PURITY_VIOLATION --severity high --file src/index.ts --message 'Found as any'",
      "bun harness.ts finding:file --code RUNTIME_ERROR --task-id task-1 --commit-sha abc1234",
    ],
    handler: findingFileCommand,
  },
];
