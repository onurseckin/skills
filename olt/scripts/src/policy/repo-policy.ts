import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
  type Stats,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { HarnessError } from "../core/errors/harness-error.ts";
import { findRepoRoot, resolveSkillHomeRepo } from "../core/shared/paths.ts";
import { releaseFlock, tryExclusiveFlock } from "../platform/flock-ffi.ts";

export type RepoEcosystem = "bun" | "node" | "python" | "cargo" | "unknown";

export interface TestRunnerPolicy {
  readonly default_command: string;
  readonly targeted_pattern: string;
  readonly full_suite_command: string;
}

export interface ReviewProtocolPolicy {
  readonly max_adversarial_pushes: number;
  readonly cognitive_pushes: number;
  readonly escalate_on_exhausted_adversarial?: boolean;
}

export const DEFAULT_REVIEW_PROTOCOL_POLICY: ReviewProtocolPolicy = {
  max_adversarial_pushes: 20,
  cognitive_pushes: 5,
  escalate_on_exhausted_adversarial: true,
};

export interface PlanningPolicy {
  readonly mandatory_brainstorming_rounds: number;
  readonly socratic_expansion_depth: number;
  readonly enforce_edge_case_matrix: boolean;
  readonly min_tasks_per_complex_prompt: number;
  readonly max_files_per_task: number;
  readonly reject_shallow_umbrella_compression: boolean;
}

export const DEFAULT_PLANNING_POLICY: PlanningPolicy = {
  mandatory_brainstorming_rounds: 3,
  socratic_expansion_depth: 8,
  enforce_edge_case_matrix: true,
  min_tasks_per_complex_prompt: 6,
  max_files_per_task: 2,
  reject_shallow_umbrella_compression: true,
};

export interface RepoPolicy {
  readonly schema_version: number;
  readonly ecosystem: RepoEcosystem;
  readonly package_manager?: string | undefined;
  readonly skill_home_repo_root?: string | undefined;
  readonly test_runner: TestRunnerPolicy;
  readonly typecheck_command?: string | undefined;
  readonly lint_command?: string | undefined;
  readonly allowed_commands?: readonly string[] | undefined;
  readonly forbidden_commands?: readonly string[] | undefined;
  readonly read_scope_neighborhood_depth?: number | undefined;
  readonly review_protocol?: ReviewProtocolPolicy | undefined;
  readonly planning?: PlanningPolicy | undefined;
}

export const CURRENT_POLICY_SCHEMA_VERSION = 1;

const SUPPORTED_TOP_LEVEL_POLICY_KEYS = new Set<keyof RepoPolicy>([
  "schema_version",
  "ecosystem",
  "package_manager",
  "skill_home_repo_root",
  "test_runner",
  "typecheck_command",
  "lint_command",
  "allowed_commands",
  "forbidden_commands",
  "read_scope_neighborhood_depth",
  "review_protocol",
  "planning",
]);

export function detectRepoEcosystem(repoRoot?: string): RepoEcosystem {
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();

  if (existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb"))) {
    return "bun";
  }

  if (existsSync(join(root, "Cargo.toml")) || existsSync(join(root, "Cargo.lock"))) {
    return "cargo";
  }

  if (
    existsSync(join(root, "pyproject.toml")) ||
    existsSync(join(root, "requirements.txt")) ||
    existsSync(join(root, "Pipfile")) ||
    existsSync(join(root, "setup.py"))
  ) {
    return "python";
  }

  if (
    existsSync(join(root, "package.json")) ||
    existsSync(join(root, "package-lock.json")) ||
    existsSync(join(root, "yarn.lock")) ||
    existsSync(join(root, "pnpm-lock.yaml"))
  ) {
    return "node";
  }

  return "unknown";
}

export function generateDefaultRepoPolicy(repoRoot?: string): RepoPolicy {
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  const ecosystem = detectRepoEcosystem(root);

  switch (ecosystem) {
    case "bun":
      return {
        schema_version: CURRENT_POLICY_SCHEMA_VERSION,
        ecosystem: "bun",
        package_manager: "bun",
        skill_home_repo_root: resolveSkillHomeRepo(),
        test_runner: {
          default_command: "bun test",
          targeted_pattern: "bun test <path>",
          full_suite_command: "bun test",
        },
        typecheck_command: "bun run typecheck",
        lint_command: "bun run lint",
        allowed_commands: [
          "bun test",
          "bun run",
          "tsc",
          "git status",
          "git diff",
          "git log",
          "ls",
          "find",
          "grep",
          "cat",
          "wc",
        ],
        forbidden_commands: ["git commit", "git push", "git reset", "rm -rf /"],
        read_scope_neighborhood_depth: 2,
        review_protocol: DEFAULT_REVIEW_PROTOCOL_POLICY,
        planning: { ...DEFAULT_PLANNING_POLICY },
      };

    case "cargo":
      return {
        schema_version: CURRENT_POLICY_SCHEMA_VERSION,
        ecosystem: "cargo",
        package_manager: "cargo",
        skill_home_repo_root: resolveSkillHomeRepo(),
        test_runner: {
          default_command: "cargo test",
          targeted_pattern: "cargo test -- <path>",
          full_suite_command: "cargo test",
        },
        typecheck_command: "cargo check",
        lint_command: "cargo clippy",
        allowed_commands: [
          "cargo test",
          "cargo check",
          "cargo clippy",
          "git status",
          "git diff",
          "ls",
          "grep",
        ],
        forbidden_commands: ["git commit", "git push", "git reset"],
        read_scope_neighborhood_depth: 2,
        review_protocol: DEFAULT_REVIEW_PROTOCOL_POLICY,
        planning: { ...DEFAULT_PLANNING_POLICY },
      };

    case "python":
      return {
        schema_version: CURRENT_POLICY_SCHEMA_VERSION,
        ecosystem: "python",
        package_manager: existsSync(join(root, "poetry.lock"))
          ? "poetry"
          : existsSync(join(root, "Pipfile"))
            ? "pipenv"
            : "pip",
        skill_home_repo_root: resolveSkillHomeRepo(),
        test_runner: {
          default_command: "pytest",
          targeted_pattern: "pytest <path>",
          full_suite_command: "pytest",
        },
        typecheck_command: "mypy",
        lint_command: "ruff check",
        allowed_commands: [
          "pytest",
          "python -m pytest",
          "mypy",
          "ruff check",
          "git status",
          "git diff",
          "ls",
          "grep",
        ],
        forbidden_commands: ["git commit", "git push", "git reset"],
        read_scope_neighborhood_depth: 2,
        review_protocol: DEFAULT_REVIEW_PROTOCOL_POLICY,
        planning: { ...DEFAULT_PLANNING_POLICY },
      };

    case "node": {
      const pm = existsSync(join(root, "pnpm-lock.yaml"))
        ? "pnpm"
        : existsSync(join(root, "yarn.lock"))
          ? "yarn"
          : "npm";
      const runner = pm === "npm" ? "npm test --" : pm === "pnpm" ? "pnpm test" : "yarn test";
      return {
        schema_version: CURRENT_POLICY_SCHEMA_VERSION,
        ecosystem: "node",
        package_manager: pm,
        skill_home_repo_root: resolveSkillHomeRepo(),
        test_runner: {
          default_command: `${pm} test`,
          targeted_pattern: `${runner} <path>`,
          full_suite_command: `${pm} test`,
        },
        typecheck_command: "npm run typecheck",
        lint_command: "npm run lint",
        allowed_commands: [`${pm} test`, "npm test", "git status", "git diff", "ls", "grep"],
        forbidden_commands: ["git commit", "git push", "git reset"],
        read_scope_neighborhood_depth: 2,
        review_protocol: DEFAULT_REVIEW_PROTOCOL_POLICY,
        planning: { ...DEFAULT_PLANNING_POLICY },
      };
    }

    default:
      return {
        schema_version: CURRENT_POLICY_SCHEMA_VERSION,
        ecosystem: "unknown",
        skill_home_repo_root: resolveSkillHomeRepo(),
        test_runner: {
          default_command: "test",
          targeted_pattern: "test <path>",
          full_suite_command: "test",
        },
        read_scope_neighborhood_depth: 2,
        review_protocol: DEFAULT_REVIEW_PROTOCOL_POLICY,
        planning: { ...DEFAULT_PLANNING_POLICY },
      };
  }
}

export function validateRepoPolicy(raw: unknown): RepoPolicy {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new HarnessError("INVALID_ARGUMENT", "Repo policy must be an object");
  }

  const rec = raw as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (!SUPPORTED_TOP_LEVEL_POLICY_KEYS.has(key as keyof RepoPolicy)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Repo policy contains unknown top-level key '${key}'`,
      );
    }
  }
  const schemaVersion =
    typeof rec["schema_version"] === "number"
      ? rec["schema_version"]
      : CURRENT_POLICY_SCHEMA_VERSION;

  const rawEco = typeof rec["ecosystem"] === "string" ? rec["ecosystem"].toLowerCase() : "unknown";
  const ecosystem: RepoEcosystem =
    rawEco === "bun" || rawEco === "node" || rawEco === "python" || rawEco === "cargo"
      ? rawEco
      : "unknown";

  const packageManager =
    typeof rec["package_manager"] === "string" ? rec["package_manager"] : undefined;

  const skillHomeRepoRoot =
    typeof rec["skill_home_repo_root"] === "string" && rec["skill_home_repo_root"].trim()
      ? rec["skill_home_repo_root"].trim()
      : undefined;

  let testRunner: TestRunnerPolicy;
  if (typeof rec["test_runner"] === "object" && rec["test_runner"] !== null) {
    const tr = rec["test_runner"] as Record<string, unknown>;
    testRunner = {
      default_command:
        typeof tr["default_command"] === "string" && tr["default_command"].trim()
          ? tr["default_command"].trim()
          : "bun test",
      targeted_pattern:
        typeof tr["targeted_pattern"] === "string" && tr["targeted_pattern"].trim()
          ? tr["targeted_pattern"].trim()
          : "bun test <path>",
      full_suite_command:
        typeof tr["full_suite_command"] === "string" && tr["full_suite_command"].trim()
          ? tr["full_suite_command"].trim()
          : "bun test",
    };
  } else {
    testRunner = {
      default_command: "bun test",
      targeted_pattern: "bun test <path>",
      full_suite_command: "bun test",
    };
  }

  const typecheckCommand =
    typeof rec["typecheck_command"] === "string" && rec["typecheck_command"].trim()
      ? rec["typecheck_command"].trim()
      : undefined;

  const lintCommand =
    typeof rec["lint_command"] === "string" && rec["lint_command"].trim()
      ? rec["lint_command"].trim()
      : undefined;

  const allowedCommands = Array.isArray(rec["allowed_commands"])
    ? rec["allowed_commands"].filter(
        (c): c is string => typeof c === "string" && c.trim().length > 0,
      )
    : undefined;

  const forbiddenCommands = Array.isArray(rec["forbidden_commands"])
    ? rec["forbidden_commands"].filter(
        (c): c is string => typeof c === "string" && c.trim().length > 0,
      )
    : undefined;

  const readScopeDepth =
    typeof rec["read_scope_neighborhood_depth"] === "number" &&
    rec["read_scope_neighborhood_depth"] >= 0
      ? rec["read_scope_neighborhood_depth"]
      : 2;

  let reviewProtocol: ReviewProtocolPolicy | undefined;
  if (typeof rec["review_protocol"] === "object" && rec["review_protocol"] !== null) {
    const rp = rec["review_protocol"] as Record<string, unknown>;
    const maxAdv =
      typeof rp["max_adversarial_pushes"] === "number" &&
      Number.isSafeInteger(rp["max_adversarial_pushes"]) &&
      rp["max_adversarial_pushes"] >= 1
        ? rp["max_adversarial_pushes"]
        : DEFAULT_REVIEW_PROTOCOL_POLICY.max_adversarial_pushes;
    const cogPushes =
      typeof rp["cognitive_pushes"] === "number" &&
      Number.isSafeInteger(rp["cognitive_pushes"]) &&
      rp["cognitive_pushes"] >= 0
        ? rp["cognitive_pushes"]
        : DEFAULT_REVIEW_PROTOCOL_POLICY.cognitive_pushes;
    const escalateOnExhausted =
      typeof rp["escalate_on_exhausted_adversarial"] === "boolean"
        ? rp["escalate_on_exhausted_adversarial"]
        : (DEFAULT_REVIEW_PROTOCOL_POLICY.escalate_on_exhausted_adversarial ?? true);

    reviewProtocol = {
      max_adversarial_pushes: maxAdv,
      cognitive_pushes: cogPushes,
      escalate_on_exhausted_adversarial: escalateOnExhausted,
    };
  } else {
    reviewProtocol = DEFAULT_REVIEW_PROTOCOL_POLICY;
  }

  let planning: PlanningPolicy | undefined;
  if (typeof rec["planning"] === "object" && rec["planning"] !== null) {
    const pl = rec["planning"] as Record<string, unknown>;
    const mandatoryBrainstorming =
      typeof pl["mandatory_brainstorming_rounds"] === "number" &&
      Number.isSafeInteger(pl["mandatory_brainstorming_rounds"]) &&
      pl["mandatory_brainstorming_rounds"] >= 0
        ? pl["mandatory_brainstorming_rounds"]
        : DEFAULT_PLANNING_POLICY.mandatory_brainstorming_rounds;
    const socraticExpansionDepth =
      typeof pl["socratic_expansion_depth"] === "number" &&
      Number.isSafeInteger(pl["socratic_expansion_depth"]) &&
      pl["socratic_expansion_depth"] >= 0
        ? pl["socratic_expansion_depth"]
        : DEFAULT_PLANNING_POLICY.socratic_expansion_depth;
    const enforceEdgeCaseMatrix =
      typeof pl["enforce_edge_case_matrix"] === "boolean"
        ? pl["enforce_edge_case_matrix"]
        : DEFAULT_PLANNING_POLICY.enforce_edge_case_matrix;
    const minTasksPerComplexPrompt =
      typeof pl["min_tasks_per_complex_prompt"] === "number" &&
      Number.isSafeInteger(pl["min_tasks_per_complex_prompt"]) &&
      pl["min_tasks_per_complex_prompt"] >= 1
        ? pl["min_tasks_per_complex_prompt"]
        : DEFAULT_PLANNING_POLICY.min_tasks_per_complex_prompt;
    const maxFilesPerTask =
      typeof pl["max_files_per_task"] === "number" &&
      Number.isSafeInteger(pl["max_files_per_task"]) &&
      pl["max_files_per_task"] >= 1
        ? pl["max_files_per_task"]
        : DEFAULT_PLANNING_POLICY.max_files_per_task;
    const rejectShallowCompression =
      typeof pl["reject_shallow_umbrella_compression"] === "boolean"
        ? pl["reject_shallow_umbrella_compression"]
        : DEFAULT_PLANNING_POLICY.reject_shallow_umbrella_compression;

    planning = {
      mandatory_brainstorming_rounds: mandatoryBrainstorming,
      socratic_expansion_depth: socraticExpansionDepth,
      enforce_edge_case_matrix: enforceEdgeCaseMatrix,
      min_tasks_per_complex_prompt: minTasksPerComplexPrompt,
      max_files_per_task: maxFilesPerTask,
      reject_shallow_umbrella_compression: rejectShallowCompression,
    };
  } else {
    planning = { ...DEFAULT_PLANNING_POLICY };
  }

  return {
    schema_version: schemaVersion,
    ecosystem,
    ...(packageManager ? { package_manager: packageManager } : {}),
    ...(skillHomeRepoRoot ? { skill_home_repo_root: skillHomeRepoRoot } : {}),
    test_runner: testRunner,
    ...(typecheckCommand ? { typecheck_command: typecheckCommand } : {}),
    ...(lintCommand ? { lint_command: lintCommand } : {}),
    ...(allowedCommands ? { allowed_commands: allowedCommands } : {}),
    ...(forbiddenCommands ? { forbidden_commands: forbiddenCommands } : {}),
    read_scope_neighborhood_depth: readScopeDepth,
    review_protocol: reviewProtocol,
    planning,
  };
}

const POLICY_MAX_READ_SCOPE_DEPTH = 64;
const POLICY_MAX_REVIEW_PUSHES = 100;
const POLICY_MAX_PLANNING_ROUNDS = 100;
const POLICY_MAX_FILES_PER_TASK = 100;
const activePolicyLocks = new Set<string>();

function integrity(path: string, message: string): never {
  throw new HarnessError("INTEGRITY", `Repo policy ${path}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKnownKeys(
  record: Record<string, unknown>,
  path: string,
  keys: readonly string[],
): void {
  const supported = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!supported.has(key)) integrity(`${path}.${key}`, "is not a supported policy field");
  }
}

function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) integrity(path, "must be an object");
  return value;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    integrity(path, "must be a non-empty string");
  return value.trim();
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  path: string,
): string | undefined {
  if (!(key in record)) return undefined;
  return requiredString(record[key], `${path}.${key}`);
}

function optionalInteger(
  record: Record<string, unknown>,
  key: string,
  path: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (!(key in record)) return fallback;
  const value = record[key];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    integrity(`${path}.${key}`, `must be an integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
  path: string,
  fallback: boolean,
): boolean {
  if (!(key in record)) return fallback;
  if (typeof record[key] !== "boolean") integrity(`${path}.${key}`, "must be a boolean");
  return record[key] as boolean;
}

function optionalCommandArray(
  record: Record<string, unknown>,
  key: "allowed_commands" | "forbidden_commands",
): readonly string[] | undefined {
  if (!(key in record)) return undefined;
  const value = record[key];
  if (!Array.isArray(value)) integrity(key, "must be an array of non-empty strings");
  const commands: string[] = [];
  const seen = new Set<string>();
  for (const [index, command] of value.entries()) {
    const normalized = requiredString(command, `${key}[${index}]`);
    if (seen.has(normalized)) integrity(`${key}[${index}]`, `duplicates '${normalized}'`);
    seen.add(normalized);
    commands.push(normalized);
  }
  return commands;
}

/**
 * Parses policy bytes intended to confer authority. Unlike validateRepoPolicy,
 * this rejects every malformed present value rather than silently defaulting it.
 */
export function parseAuthorityRepoPolicy(raw: unknown): RepoPolicy {
  const record = requiredRecord(raw, "$");
  assertKnownKeys(record, "$", [...SUPPORTED_TOP_LEVEL_POLICY_KEYS]);

  const schemaVersion = record["schema_version"];
  if (
    typeof schemaVersion !== "number" ||
    !Number.isSafeInteger(schemaVersion) ||
    schemaVersion !== CURRENT_POLICY_SCHEMA_VERSION
  ) {
    integrity("$.schema_version", `must equal supported version ${CURRENT_POLICY_SCHEMA_VERSION}`);
  }

  const ecosystem = record["ecosystem"];
  if (
    ecosystem !== "bun" &&
    ecosystem !== "node" &&
    ecosystem !== "python" &&
    ecosystem !== "cargo" &&
    ecosystem !== "unknown"
  ) {
    integrity("$.ecosystem", "must be one of bun, node, python, cargo, or unknown");
  }

  const rawRunner = requiredRecord(record["test_runner"], "$.test_runner");
  assertKnownKeys(rawRunner, "$.test_runner", [
    "default_command",
    "targeted_pattern",
    "full_suite_command",
  ]);
  const testRunner: TestRunnerPolicy = {
    default_command: requiredString(rawRunner["default_command"], "$.test_runner.default_command"),
    targeted_pattern: requiredString(
      rawRunner["targeted_pattern"],
      "$.test_runner.targeted_pattern",
    ),
    full_suite_command: requiredString(
      rawRunner["full_suite_command"],
      "$.test_runner.full_suite_command",
    ),
  };

  const allowedCommands = optionalCommandArray(record, "allowed_commands");
  const forbiddenCommands = optionalCommandArray(record, "forbidden_commands");
  const allowed = new Set(allowedCommands ?? []);
  for (const command of forbiddenCommands ?? []) {
    if (allowed.has(command))
      integrity("$.forbidden_commands", `conflicts with allowed command '${command}'`);
  }

  const reviewRecord =
    "review_protocol" in record
      ? requiredRecord(record["review_protocol"], "$.review_protocol")
      : undefined;
  if (reviewRecord)
    assertKnownKeys(reviewRecord, "$.review_protocol", [
      "max_adversarial_pushes",
      "cognitive_pushes",
      "escalate_on_exhausted_adversarial",
    ]);
  const reviewProtocol: ReviewProtocolPolicy = {
    max_adversarial_pushes: reviewRecord
      ? optionalInteger(
          reviewRecord,
          "max_adversarial_pushes",
          "$.review_protocol",
          1,
          POLICY_MAX_REVIEW_PUSHES,
          DEFAULT_REVIEW_PROTOCOL_POLICY.max_adversarial_pushes,
        )
      : DEFAULT_REVIEW_PROTOCOL_POLICY.max_adversarial_pushes,
    cognitive_pushes: reviewRecord
      ? optionalInteger(
          reviewRecord,
          "cognitive_pushes",
          "$.review_protocol",
          0,
          POLICY_MAX_REVIEW_PUSHES,
          DEFAULT_REVIEW_PROTOCOL_POLICY.cognitive_pushes,
        )
      : DEFAULT_REVIEW_PROTOCOL_POLICY.cognitive_pushes,
    escalate_on_exhausted_adversarial: reviewRecord
      ? optionalBoolean(
          reviewRecord,
          "escalate_on_exhausted_adversarial",
          "$.review_protocol",
          DEFAULT_REVIEW_PROTOCOL_POLICY.escalate_on_exhausted_adversarial ?? true,
        )
      : (DEFAULT_REVIEW_PROTOCOL_POLICY.escalate_on_exhausted_adversarial ?? true),
  };
  if (reviewProtocol.cognitive_pushes > reviewProtocol.max_adversarial_pushes)
    integrity("$.review_protocol.cognitive_pushes", "must not exceed max_adversarial_pushes");

  const planningRecord =
    "planning" in record ? requiredRecord(record["planning"], "$.planning") : undefined;
  if (planningRecord)
    assertKnownKeys(planningRecord, "$.planning", [
      "mandatory_brainstorming_rounds",
      "socratic_expansion_depth",
      "enforce_edge_case_matrix",
      "min_tasks_per_complex_prompt",
      "max_files_per_task",
      "reject_shallow_umbrella_compression",
    ]);
  const planning: PlanningPolicy = {
    mandatory_brainstorming_rounds: planningRecord
      ? optionalInteger(
          planningRecord,
          "mandatory_brainstorming_rounds",
          "$.planning",
          0,
          POLICY_MAX_PLANNING_ROUNDS,
          DEFAULT_PLANNING_POLICY.mandatory_brainstorming_rounds,
        )
      : DEFAULT_PLANNING_POLICY.mandatory_brainstorming_rounds,
    socratic_expansion_depth: planningRecord
      ? optionalInteger(
          planningRecord,
          "socratic_expansion_depth",
          "$.planning",
          0,
          POLICY_MAX_PLANNING_ROUNDS,
          DEFAULT_PLANNING_POLICY.socratic_expansion_depth,
        )
      : DEFAULT_PLANNING_POLICY.socratic_expansion_depth,
    enforce_edge_case_matrix: planningRecord
      ? optionalBoolean(
          planningRecord,
          "enforce_edge_case_matrix",
          "$.planning",
          DEFAULT_PLANNING_POLICY.enforce_edge_case_matrix,
        )
      : DEFAULT_PLANNING_POLICY.enforce_edge_case_matrix,
    min_tasks_per_complex_prompt: planningRecord
      ? optionalInteger(
          planningRecord,
          "min_tasks_per_complex_prompt",
          "$.planning",
          1,
          POLICY_MAX_PLANNING_ROUNDS,
          DEFAULT_PLANNING_POLICY.min_tasks_per_complex_prompt,
        )
      : DEFAULT_PLANNING_POLICY.min_tasks_per_complex_prompt,
    max_files_per_task: planningRecord
      ? optionalInteger(
          planningRecord,
          "max_files_per_task",
          "$.planning",
          1,
          POLICY_MAX_FILES_PER_TASK,
          DEFAULT_PLANNING_POLICY.max_files_per_task,
        )
      : DEFAULT_PLANNING_POLICY.max_files_per_task,
    reject_shallow_umbrella_compression: planningRecord
      ? optionalBoolean(
          planningRecord,
          "reject_shallow_umbrella_compression",
          "$.planning",
          DEFAULT_PLANNING_POLICY.reject_shallow_umbrella_compression,
        )
      : DEFAULT_PLANNING_POLICY.reject_shallow_umbrella_compression,
  };

  const readScopeDepth =
    "read_scope_neighborhood_depth" in record
      ? optionalInteger(
          record,
          "read_scope_neighborhood_depth",
          "$",
          0,
          POLICY_MAX_READ_SCOPE_DEPTH,
          2,
        )
      : 2;

  return {
    schema_version: schemaVersion,
    ecosystem,
    ...(optionalString(record, "package_manager", "$")
      ? { package_manager: optionalString(record, "package_manager", "$") }
      : {}),
    ...(optionalString(record, "skill_home_repo_root", "$")
      ? { skill_home_repo_root: optionalString(record, "skill_home_repo_root", "$") }
      : {}),
    test_runner: testRunner,
    ...(optionalString(record, "typecheck_command", "$")
      ? { typecheck_command: optionalString(record, "typecheck_command", "$") }
      : {}),
    ...(optionalString(record, "lint_command", "$")
      ? { lint_command: optionalString(record, "lint_command", "$") }
      : {}),
    ...(allowedCommands ? { allowed_commands: allowedCommands } : {}),
    ...(forbiddenCommands ? { forbidden_commands: forbiddenCommands } : {}),
    read_scope_neighborhood_depth: readScopeDepth,
    review_protocol: reviewProtocol,
    planning,
  };
}

export interface PolicyInspectionResult {
  readonly status: "valid_custom" | "invalid_custom" | "auto_detected";
  readonly policy: RepoPolicy;
  readonly filePath?: string;
  readonly error?: string;
}

function requiredNoFollowFlag(): number {
  const flag = constants.O_NOFOLLOW;
  if (!Number.isInteger(flag) || flag === 0)
    throw new HarnessError(
      "UNSUPPORTED_PLATFORM",
      "repository policy authority requires final-component O_NOFOLLOW protection",
    );
  return flag;
}

function sameInode(left: Pick<Stats, "dev" | "ino">, right: Pick<Stats, "dev" | "ino">): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertOwnedPrivateRegularFile(metadata: Stats, path: string): void {
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new HarnessError("PATH_SAFETY", `Repository policy must be a regular file: ${path}`);
  if (metadata.nlink !== 1)
    throw new HarnessError("INTEGRITY", `Repository policy must not have hard links: ${path}`);
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (uid !== undefined && metadata.uid !== uid)
    throw new HarnessError(
      "INTEGRITY",
      `Repository policy must be owned by the current user: ${path}`,
    );
  if ((metadata.mode & 0o022) !== 0)
    throw new HarnessError(
      "INTEGRITY",
      `Repository policy must not be group- or world-writable: ${path}`,
    );
}

function assertRealDirectory(path: string, label: string): Stats {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new HarnessError("PATH_SAFETY", `${label} must be a real directory: ${path}`);
  return metadata;
}

function isPathWithin(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith(".."));
}

function ensureRealDirectoryPath(root: string, target: string): void {
  if (!isPathWithin(root, target))
    throw new HarnessError(
      "PATH_SAFETY",
      `Repository policy path escapes repository root: ${target}`,
    );
  assertRealDirectory(root, "repository root");
  const segments = relative(root, target).split(sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    if (!existsSync(current)) mkdirSync(current, { recursive: false, mode: 0o700 });
    assertRealDirectory(current, "repository policy parent");
  }
}

function assertExistingDirectoryPath(root: string, target: string): void {
  if (!isPathWithin(root, target))
    throw new HarnessError(
      "PATH_SAFETY",
      `Repository policy path escapes repository root: ${target}`,
    );
  assertRealDirectory(root, "repository root");
  const segments = relative(root, target).split(sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    if (!existsSync(current)) return;
    assertRealDirectory(current, "repository policy parent");
  }
}

interface PolicyLocation {
  readonly root: string;
  readonly parent: string;
  readonly filePath: string;
}

function resolvePolicyLocation(
  repoRoot?: string,
  customPath?: string,
  createRoot = false,
): PolicyLocation {
  const requestedRoot = resolve(repoRoot ?? findRepoRoot());
  if (!existsSync(requestedRoot)) {
    const missingPath =
      customPath && customPath.trim()
        ? resolve(requestedRoot, customPath.trim())
        : join(requestedRoot, ".olt", "policy.json");
    if (!isPathWithin(requestedRoot, missingPath))
      throw new HarnessError(
        "PATH_SAFETY",
        `Custom repository policy path must remain under repository root: ${missingPath}`,
      );
    if (!createRoot) {
      // A missing repository has no custom authority to read; retain the historical auto-default path.
      return {
        root: requestedRoot,
        parent: dirname(missingPath),
        filePath: missingPath,
      };
    }
    mkdirSync(requestedRoot, { recursive: true, mode: 0o700 });
  }
  const root = resolve(requestedRoot);
  assertRealDirectory(root, "repository root");
  const stableRoot = root;
  const filePath =
    customPath && customPath.trim()
      ? resolve(stableRoot, customPath.trim())
      : join(stableRoot, ".olt", "policy.json");
  if (!isPathWithin(stableRoot, filePath))
    throw new HarnessError(
      "PATH_SAFETY",
      `Custom repository policy path must remain under repository root: ${filePath}`,
    );
  const parent = dirname(filePath);
  if (createRoot) ensureRealDirectoryPath(stableRoot, parent);
  return { root: stableRoot, parent, filePath };
}

function inspectExistingPolicyFile(path: string): Stats | undefined {
  if (!existsSync(path)) return undefined;
  const metadata = lstatSync(path);
  assertOwnedPrivateRegularFile(metadata, path);
  return metadata;
}

export interface RepoPolicyReadDependencies {
  /** Test-only seam used to prove lstat/open/read replacement detection. */
  readonly afterLstatBeforeOpen?: (path: string) => void;
  /** Test-only seam used to prove post-open path replacement detection. */
  readonly afterOpenBeforeRead?: (path: string) => void;
  /** Test-only seam used to prove descriptor ownership checks. */
  readonly fstat?: typeof fstatSync;
}

function readVerifiedPolicyFile(
  location: PolicyLocation,
  dependencies: RepoPolicyReadDependencies = {},
): string | undefined {
  const before = inspectExistingPolicyFile(location.filePath);
  if (!before) return undefined;
  const fstat = dependencies.fstat ?? fstatSync;
  let descriptor: number | undefined;
  try {
    dependencies.afterLstatBeforeOpen?.(location.filePath);
    descriptor = openSync(location.filePath, constants.O_RDONLY | requiredNoFollowFlag());
    const opened = fstat(descriptor);
    assertOwnedPrivateRegularFile(opened, location.filePath);
    dependencies.afterOpenBeforeRead?.(location.filePath);
    const afterOpen = inspectExistingPolicyFile(location.filePath);
    if (!afterOpen || !sameInode(before, opened) || !sameInode(opened, afterOpen))
      throw new HarnessError(
        "INTEGRITY",
        `Repository policy changed while opening: ${location.filePath}`,
      );
    const contents = readFileSync(descriptor, "utf-8");
    const afterRead = inspectExistingPolicyFile(location.filePath);
    const finalMetadata = fstat(descriptor);
    if (!afterRead || !sameInode(opened, finalMetadata) || !sameInode(finalMetadata, afterRead))
      throw new HarnessError(
        "INTEGRITY",
        `Repository policy changed while reading: ${location.filePath}`,
      );
    return contents;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(
    path,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | requiredNoFollowFlag(),
  );
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function withPolicyLock<T>(location: PolicyLocation, operation: () => T): T {
  const lockPath = join(location.parent, ".policy.lock");
  if (activePolicyLocks.has(location.root))
    throw new HarnessError(
      "LOCK_TIMEOUT",
      `Repository policy lock is already active: ${location.root}`,
    );
  activePolicyLocks.add(location.root);
  let descriptor: number | undefined;
  let acquired = false;
  try {
    descriptor = openSync(
      lockPath,
      constants.O_RDWR | constants.O_CREAT | requiredNoFollowFlag(),
      0o600,
    );
    assertOwnedPrivateRegularFile(fstatSync(descriptor), lockPath);
    const deadline = performance.now() + 10_000;
    while (!(acquired = tryExclusiveFlock(descriptor))) {
      const remaining = deadline - performance.now();
      if (remaining <= 0)
        throw new HarnessError(
          "LOCK_TIMEOUT",
          `timed out waiting for repository policy lock: ${lockPath}`,
        );
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(10, remaining));
    }
    return operation();
  } finally {
    if (descriptor !== undefined && acquired) releaseFlock(descriptor);
    if (descriptor !== undefined) closeSync(descriptor);
    activePolicyLocks.delete(location.root);
  }
}

export interface RepoPolicyWriteDependencies {
  readonly open?: typeof openSync;
  readonly write?: typeof writeSync;
  readonly fsync?: typeof fsyncSync;
  readonly close?: typeof closeSync;
  readonly rename?: typeof renameSync;
  readonly fsyncDirectory?: (path: string) => void;
}

export function inspectRepoPolicy(
  repoRoot?: string,
  customPath?: string,
  dependencies: RepoPolicyReadDependencies = {},
): PolicyInspectionResult {
  let location: PolicyLocation;
  try {
    location = resolvePolicyLocation(repoRoot, customPath);
  } catch (error) {
    return {
      status: "invalid_custom",
      policy: generateDefaultRepoPolicy(repoRoot),
      ...(customPath ? { filePath: customPath } : {}),
      error: safeMessage(error),
    };
  }
  if (existsSync(location.root)) {
    try {
      assertExistingDirectoryPath(location.root, location.parent);
    } catch (error) {
      return {
        status: "invalid_custom",
        policy: generateDefaultRepoPolicy(repoRoot),
        filePath: location.filePath,
        error: safeMessage(error),
      };
    }
  }
  if (!existsSync(location.filePath)) {
    return {
      status: "auto_detected",
      policy: generateDefaultRepoPolicy(repoRoot),
    };
  }

  try {
    ensureRealDirectoryPath(location.root, location.parent);
    const raw = readVerifiedPolicyFile(location, dependencies);
    if (raw === undefined)
      return { status: "auto_detected", policy: generateDefaultRepoPolicy(repoRoot) };
    const parsed = JSON.parse(raw) as unknown;
    const policy = parseAuthorityRepoPolicy(parsed);
    return {
      status: "valid_custom",
      policy,
      filePath: location.filePath,
    };
  } catch (error) {
    return {
      status: "invalid_custom",
      policy: generateDefaultRepoPolicy(repoRoot),
      filePath: location.filePath,
      error: safeMessage(error),
    };
  }
}

export function loadRepoPolicy(
  repoRoot?: string,
  customPath?: string,
  dependencies: RepoPolicyReadDependencies = {},
): RepoPolicy {
  const inspection = inspectRepoPolicy(repoRoot, customPath, dependencies);
  if (inspection.status === "invalid_custom") {
    throw new HarnessError(
      "INTEGRITY",
      `Repository policy at '${inspection.filePath}' is invalid: ${inspection.error ?? "unknown error"}`,
    );
  }

  return inspection.policy;
}

export function saveRepoPolicy(
  policy: RepoPolicy,
  repoRoot?: string,
  customPath?: string,
  dependencies: RepoPolicyWriteDependencies = {},
): string {
  const validated = parseAuthorityRepoPolicy(policy);
  const location = resolvePolicyLocation(repoRoot, customPath, true);
  const open = dependencies.open ?? openSync;
  const write = dependencies.write ?? writeSync;
  const sync = dependencies.fsync ?? fsyncSync;
  const close = dependencies.close ?? closeSync;
  const rename = dependencies.rename ?? renameSync;
  const syncDirectory = dependencies.fsyncDirectory ?? fsyncDirectory;
  const serialized = JSON.stringify(validated, null, 2) + "\n";
  const bytes = Buffer.from(serialized, "utf8");

  return withPolicyLock(location, () => {
    ensureRealDirectoryPath(location.root, location.parent);
    inspectExistingPolicyFile(location.filePath);
    const temporary = join(
      location.parent,
      `.${location.filePath.slice(location.parent.length + 1)}.${randomUUID()}.tmp`,
    );
    let descriptor: number | undefined;
    let renamed = false;
    try {
      descriptor = open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | requiredNoFollowFlag(),
        0o600,
      );
      let offset = 0;
      while (offset < bytes.byteLength) {
        const written = write(descriptor, bytes, offset, bytes.byteLength - offset);
        if (written <= 0 || written > bytes.byteLength - offset)
          throw new HarnessError(
            "INTEGRITY",
            `Repository policy write made no progress: ${location.filePath}`,
          );
        offset += written;
      }
      sync(descriptor);
      close(descriptor);
      descriptor = undefined;
      ensureRealDirectoryPath(location.root, location.parent);
      inspectExistingPolicyFile(location.filePath);
      rename(temporary, location.filePath);
      renamed = true;
      syncDirectory(location.parent);
      ensureRealDirectoryPath(location.root, location.parent);
      inspectExistingPolicyFile(location.filePath);
      return location.filePath;
    } catch (error) {
      if (renamed || !existsSync(temporary))
        throw new HarnessError(
          "INTEGRITY",
          `Repository policy write outcome is uncertain after rename: ${location.filePath}: ${safeMessage(error)}`,
        );
      throw error;
    } finally {
      if (descriptor !== undefined) close(descriptor);
      if (existsSync(temporary)) rmSync(temporary, { force: true });
    }
  });
}

export function initRepoPolicy(repoRoot?: string): RepoPolicy {
  const policy = generateDefaultRepoPolicy(repoRoot);
  saveRepoPolicy(policy, repoRoot);
  return policy;
}
