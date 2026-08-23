import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../errors/harness-error.ts";
import { findRepoRoot, resolvePolicyPath } from "../shared/paths.ts";

export type RepoEcosystem = "bun" | "node" | "python" | "cargo" | "unknown";

export interface TestRunnerPolicy {
  readonly default_command: string;
  readonly targeted_pattern: string;
  readonly full_suite_command: string;
}

export interface RepoPolicy {
  readonly schema_version: number;
  readonly ecosystem: RepoEcosystem;
  readonly package_manager?: string | undefined;
  readonly test_runner: TestRunnerPolicy;
  readonly typecheck_command?: string | undefined;
  readonly lint_command?: string | undefined;
  readonly allowed_commands?: readonly string[] | undefined;
  readonly forbidden_commands?: readonly string[] | undefined;
  readonly read_scope_neighborhood_depth?: number | undefined;
}

export const CURRENT_POLICY_SCHEMA_VERSION = 1;

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
      };

    case "cargo":
      return {
        schema_version: CURRENT_POLICY_SCHEMA_VERSION,
        ecosystem: "cargo",
        package_manager: "cargo",
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
      };
    }

    default:
      return {
        schema_version: CURRENT_POLICY_SCHEMA_VERSION,
        ecosystem: "unknown",
        test_runner: {
          default_command: "test",
          targeted_pattern: "test <path>",
          full_suite_command: "test",
        },
        read_scope_neighborhood_depth: 2,
      };
  }
}

export function validateRepoPolicy(raw: unknown): RepoPolicy {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new HarnessError("INVALID_ARGUMENT", "Repo policy must be an object");
  }

  const rec = raw as Record<string, unknown>;
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

  return {
    schema_version: schemaVersion,
    ecosystem,
    ...(packageManager ? { package_manager: packageManager } : {}),
    test_runner: testRunner,
    ...(typecheckCommand ? { typecheck_command: typecheckCommand } : {}),
    ...(lintCommand ? { lint_command: lintCommand } : {}),
    ...(allowedCommands ? { allowed_commands: allowedCommands } : {}),
    ...(forbiddenCommands ? { forbidden_commands: forbiddenCommands } : {}),
    read_scope_neighborhood_depth: readScopeDepth,
  };
}

export function loadRepoPolicy(repoRoot?: string, customPath?: string): RepoPolicy {
  const filePath = resolvePolicyPath(repoRoot, customPath);
  if (!existsSync(filePath)) {
    return generateDefaultRepoPolicy(repoRoot);
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return validateRepoPolicy(parsed);
  } catch {
    return generateDefaultRepoPolicy(repoRoot);
  }
}

export function saveRepoPolicy(policy: RepoPolicy, repoRoot?: string, customPath?: string): string {
  const filePath = resolvePolicyPath(repoRoot, customPath);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const validated = validateRepoPolicy(policy);
  writeFileSync(filePath, JSON.stringify(validated, null, 2) + "\n", "utf-8");
  return filePath;
}

export function initRepoPolicy(repoRoot?: string): RepoPolicy {
  const policy = generateDefaultRepoPolicy(repoRoot);
  saveRepoPolicy(policy, repoRoot);
  return policy;
}
