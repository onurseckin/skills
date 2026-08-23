import type { AgentMetadata } from "../runtime/agent-metadata.ts";
import { inferCanExecuteShell } from "../runtime/agent-metadata.ts";
import type { RepoPolicy } from "./repo-policy.ts";
import { loadRepoPolicy } from "./repo-policy.ts";

export interface AuthorizationResult {
  readonly authorized: boolean;
  readonly error_code?:
    | "PERMISSION_DENIED"
    | "INVALID_SCOPE"
    | "UNSHIELDED_COMMAND_BLUNDER"
    | string
    | undefined;
  readonly reason?: string | undefined;
  readonly message?: string | undefined;
}

export const STATIC_SUPERVISOR_FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /^git\s+(commit|push|reset|checkout\s+-b|merge|rebase)/i,
  /write_to_file/i,
  /replace_file/i,
  /^bun\s+test\b/i,
  /^npm\s+test\b/i,
  /^vitest\b/i,
  /^pytest\b/i,
  /^cargo\s+test\b/i,
];

export const STATIC_IMPLEMENTER_FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /^git\s+(commit|push|reset|checkout(\s+-b)?|rebase|merge)/i,
  /^bun\s+harness.*task:review/i,
  /^bun\s+harness.*run:complete/i,
  /^bun\s+harness.*mind:/i,
];

export const FORBIDDEN_SUBSHELL_AND_EVAL_PATTERNS: readonly RegExp[] = [
  /^(ba|z|fi|k|c|tc)?sh(\.exe)?(\s+-(c|e|i|s)|\s*$|\s+)/i,
  /^eval\b/i,
  /^exec\b/i,
  /^(node|bun|deno)(\.exe)?\s+(-e|--eval)\b/i,
  /^(python|python3|perl|ruby)(\.exe)?\s+(-c|-e)\b/i,
];

export interface TestRunnerSpec {
  readonly prefixTokens: readonly string[];
  readonly modeKeywords?: readonly string[];
  readonly flagsWithValue?: readonly string[];
}

export const KNOWN_TEST_RUNNERS: readonly TestRunnerSpec[] = [
  { prefixTokens: ["python", "-m", "pytest"], flagsWithValue: ["-m", "-k", "-c", "-o"] },
  { prefixTokens: ["python3", "-m", "pytest"], flagsWithValue: ["-m", "-k", "-c", "-o"] },
  { prefixTokens: ["poetry", "run", "pytest"], flagsWithValue: ["-m", "-k", "-c", "-o"] },
  { prefixTokens: ["pipenv", "run", "pytest"], flagsWithValue: ["-m", "-k", "-c", "-o"] },
  { prefixTokens: ["bun", "test"], flagsWithValue: ["--timeout", "-t", "--preload", "--filter"] },
  { prefixTokens: ["npm", "test"], flagsWithValue: [] },
  { prefixTokens: ["pnpm", "test"], flagsWithValue: [] },
  { prefixTokens: ["yarn", "test"], flagsWithValue: [] },
  {
    prefixTokens: ["cargo", "test"],
    flagsWithValue: ["--package", "-p", "--bin", "--example", "--test", "--bench"],
  },
  { prefixTokens: ["pytest"], flagsWithValue: ["-m", "-k", "-c", "-o"] },
  {
    prefixTokens: ["go", "test"],
    flagsWithValue: ["-run", "-bench", "-tags", "-timeout", "-count", "-cpu"],
  },
  {
    prefixTokens: ["mvn", "test"],
    flagsWithValue: ["-Dtest", "-DfailIfNoTests", "-pl", "-f"],
  },
  {
    prefixTokens: ["gradle", "test"],
    flagsWithValue: ["--tests", "-P", "-D"],
  },
  {
    prefixTokens: ["./gradlew", "test"],
    flagsWithValue: ["--tests", "-P", "-D"],
  },
  {
    prefixTokens: ["dotnet", "test"],
    flagsWithValue: ["--filter", "-f", "-c", "--configuration", "-l", "--logger"],
  },
  {
    prefixTokens: ["mix", "test"],
    flagsWithValue: ["--only", "--exclude", "--seed", "--stale"],
  },
  {
    prefixTokens: ["vitest"],
    modeKeywords: ["run", "watch", "related", "bench"],
    flagsWithValue: ["-t", "--testNamePattern", "-c", "--config"],
  },
  {
    prefixTokens: ["jest"],
    modeKeywords: ["run", "watch"],
    flagsWithValue: ["-t", "--testNamePattern", "-c", "--config", "--testPathPattern"],
  },
  {
    prefixTokens: ["bunx", "vitest"],
    modeKeywords: ["run", "watch", "related", "bench"],
    flagsWithValue: ["-t", "--testNamePattern", "-c", "--config"],
  },
  {
    prefixTokens: ["npx", "vitest"],
    modeKeywords: ["run", "watch", "related", "bench"],
    flagsWithValue: ["-t", "--testNamePattern", "-c", "--config"],
  },
  {
    prefixTokens: ["npx", "jest"],
    modeKeywords: ["run", "watch"],
    flagsWithValue: ["-t", "--testNamePattern", "-c", "--config", "--testPathPattern"],
  },
];

export function hasUnshieldedSubshellOrChaining(
  commandStr: string,
  argv: readonly string[],
): { detected: boolean; reason?: string } {
  const firstToken = (argv[0] ?? "").toLowerCase();

  const subshellBinaries = new Set([
    "sh",
    "bash",
    "zsh",
    "fish",
    "ksh",
    "csh",
    "tcsh",
    "dash",
    "sh.exe",
    "bash.exe",
    "zsh.exe",
  ]);

  if (subshellBinaries.has(firstToken)) {
    return {
      detected: true,
      reason: `Subshell binary invocation detected: '${firstToken}'`,
    };
  }

  if (firstToken === "eval" || firstToken === "exec") {
    return {
      detected: true,
      reason: `Direct evaluator invocation detected: '${firstToken}'`,
    };
  }

  if (
    (firstToken === "node" ||
      firstToken === "bun" ||
      firstToken === "deno" ||
      firstToken === "node.exe" ||
      firstToken === "bun.exe") &&
    argv.some((a) => a === "-e" || a === "--eval" || a.startsWith("-e=") || a.startsWith("--eval="))
  ) {
    return {
      detected: true,
      reason: `Inline code evaluator detected: '${firstToken} -e'`,
    };
  }

  if (
    (firstToken === "python" ||
      firstToken === "python3" ||
      firstToken === "perl" ||
      firstToken === "ruby") &&
    argv.some((a) => a === "-c" || a === "-e" || a.startsWith("-c=") || a.startsWith("-e="))
  ) {
    return {
      detected: true,
      reason: `Inline code evaluator detected: '${firstToken}'`,
    };
  }

  for (const arg of argv) {
    if (arg === "&&" || arg === "||" || arg === ";" || arg === "|" || arg === "&") {
      return {
        detected: true,
        reason: `Command chaining operator detected in argv: '${arg}'`,
      };
    }
  }

  for (const pattern of FORBIDDEN_SUBSHELL_AND_EVAL_PATTERNS) {
    if (pattern.test(commandStr)) {
      return {
        detected: true,
        reason: `Command matched subshell/evaluator pattern: ${pattern.toString()}`,
      };
    }
  }

  return { detected: false };
}

export function isTargetTestArgument(token: string): boolean {
  const trimmed = token.trim();
  if (!trimmed || trimmed.startsWith("-") || trimmed === "--") return false;

  // Whole repo wildcards in Go/Rust/glob (e.g. ./... or ...)
  if (trimmed === "./..." || trimmed === "..." || trimmed === ".") return false;

  // Pure numeric literals (e.g. 1234, 4, 5000)
  if (/^\d+$/.test(trimmed)) return false;

  // Boolean literals
  if (trimmed.toLowerCase() === "true" || trimmed.toLowerCase() === "false") return false;

  // Non-target CLI flags, test modes, common config keys/values, reporter formats
  const ignoredKeywords = new Set([
    "all",
    "workspace",
    "run",
    "watch",
    "related",
    "bench",
    "coverage",
    "cov",
    "bail",
    "quiet",
    "silent",
    "verbose",
    "json",
    "tap",
    "junit",
    "html",
    "text",
    "lcov",
    "node",
    "bun",
    "browser",
    "jsdom",
    "happy-dom",
  ]);
  if (ignoredKeywords.has(trimmed.toLowerCase())) return false;

  // Key=value argument that does not contain a file path
  if (/^[a-zA-Z0-9_-]+=[a-zA-Z0-9_-]+$/.test(trimmed) && !trimmed.includes("/")) {
    return false;
  }

  // Directory path or file path with slashes (excluding root/wildcard)
  if (trimmed.includes("/") || trimmed.includes("\\")) return true;

  // Known test or source file extension / naming patterns
  if (
    /\.(test|spec)\.[a-zA-Z0-9]+$/i.test(trimmed) ||
    /\.(ts|tsx|js|jsx|py|rs|go|rb|cpp|c|h|java|kt|scala|cs|php|ex|exs)$/i.test(trimmed) ||
    /^test_/i.test(trimmed) ||
    /_test$/i.test(trimmed) ||
    /_test\./i.test(trimmed) ||
    /Test\.java$/i.test(trimmed)
  ) {
    return true;
  }

  // Non-keyword identifier (e.g. cargo test test_name or pytest test_function)
  if (/^[a-zA-Z_][a-zA-Z0-9_:-]*$/.test(trimmed)) {
    return true;
  }

  return false;
}

export function isUntargetedTestCommand(
  commandStr: string,
  argvInput?: readonly string[],
  policy?: RepoPolicy,
): boolean {
  const trimmed = commandStr.trim();
  const tokens = argvInput && argvInput.length > 0 ? argvInput : trimmed.split(/\s+/);
  if (tokens.length === 0 || tokens[0] === "") return false;

  for (const runner of KNOWN_TEST_RUNNERS) {
    if (tokens.length < runner.prefixTokens.length) continue;

    let matchesPrefix = true;
    for (let i = 0; i < runner.prefixTokens.length; i++) {
      if (tokens[i]!.toLowerCase() !== runner.prefixTokens[i]!.toLowerCase()) {
        matchesPrefix = false;
        break;
      }
    }

    if (matchesPrefix) {
      const rest = tokens.slice(runner.prefixTokens.length);
      const targetArgs: string[] = [];
      const flagsWithValueSet = new Set(runner.flagsWithValue ?? []);
      const modeKeywordsSet = new Set(runner.modeKeywords ?? []);

      for (let i = 0; i < rest.length; i++) {
        const token = rest[i]!;
        if (token === "--") {
          continue;
        }
        if (token.startsWith("-")) {
          if (
            flagsWithValueSet.has(token) &&
            i + 1 < rest.length &&
            !rest[i + 1]!.startsWith("-")
          ) {
            i++; // skip flag value argument
          }
          continue;
        }
        if (modeKeywordsSet.has(token.toLowerCase())) {
          continue;
        }
        if (isTargetTestArgument(token)) {
          targetArgs.push(token);
        }
      }

      // If no valid targeted arguments remain, it is an un-targeted test run!
      return targetArgs.length === 0;
    }
  }

  // Check dynamic full suite command from policy
  if (policy?.test_runner?.full_suite_command) {
    const fullTokens = policy.test_runner.full_suite_command.trim().split(/\s+/);
    if (tokens.length >= fullTokens.length) {
      let matchesFull = true;
      for (let i = 0; i < fullTokens.length; i++) {
        if (tokens[i]!.toLowerCase() !== fullTokens[i]!.toLowerCase()) {
          matchesFull = false;
          break;
        }
      }
      if (matchesFull) {
        const rest = tokens.slice(fullTokens.length);
        const validTargets = rest.filter((t) => isTargetTestArgument(t));
        return validTargets.length === 0;
      }
    }
  }

  return false;
}

export function compileEffectiveForbiddenPatterns(role: string, policy?: RepoPolicy): RegExp[] {
  const normalizedRole = role.trim().toLowerCase();
  const activePolicy = policy ?? loadRepoPolicy();

  // Cognitive Validators: Hard-lock matches everything (0 commands allowed)
  if (
    normalizedRole === "validator" ||
    normalizedRole === "cognitive-validator" ||
    normalizedRole === "cognitive_validator" ||
    normalizedRole.startsWith("validator-") ||
    normalizedRole === "critic" ||
    normalizedRole === "completeness-critic" ||
    normalizedRole === "completeness_critic" ||
    normalizedRole === "planner" ||
    normalizedRole === "plan-validator" ||
    normalizedRole === "plan_validator" ||
    normalizedRole === "sub-investigator" ||
    normalizedRole === "sub_investigator"
  ) {
    return [/.*/];
  }

  // Supervisors
  if (
    normalizedRole === "mind" ||
    normalizedRole === "orchestrator" ||
    normalizedRole === "coordinator" ||
    normalizedRole === "meta-auditor" ||
    normalizedRole === "meta_auditor" ||
    normalizedRole === "mind-auditor" ||
    normalizedRole === "mind_auditor"
  ) {
    const supervisorPatterns = [...STATIC_SUPERVISOR_FORBIDDEN_PATTERNS];
    if (activePolicy.forbidden_commands) {
      for (const cmd of activePolicy.forbidden_commands) {
        supervisorPatterns.push(new RegExp(`^${escapeRegex(cmd)}`, "i"));
      }
    }
    return supervisorPatterns;
  }

  // Mechanic Validators: Can run typechecks, AST static audits, tests; cannot mutate git or source files
  if (
    normalizedRole === "mechanic-validator" ||
    normalizedRole === "mechanic_validator" ||
    normalizedRole === "sub-validator" ||
    normalizedRole === "sub_validator"
  ) {
    return [
      /^git\s+(commit|push|reset|checkout(\s+-b)?|merge|rebase)/i,
      /write_to_file/i,
      /replace_file/i,
      /^bun\s+harness.*task:review/i,
      /^bun\s+harness.*run:complete/i,
    ];
  }

  // Implementers / Repairers / Workers
  const implementerPatterns: RegExp[] = [...STATIC_IMPLEMENTER_FORBIDDEN_PATTERNS];

  if (activePolicy.forbidden_commands) {
    for (const cmd of activePolicy.forbidden_commands) {
      implementerPatterns.push(new RegExp(`^${escapeRegex(cmd)}`, "i"));
    }
  }

  return implementerPatterns;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function verifyCommandAuthorization(
  actor:
    | AgentMetadata
    | {
        readonly role: string;
        readonly agent_id?: string | undefined;
        readonly actor_id?: string | undefined;
        readonly can_execute_shell?: boolean | undefined;
      },
  command: string | readonly string[],
  policy?: RepoPolicy,
): AuthorizationResult {
  const role = actor.role.trim();
  const roleCanExecute = inferCanExecuteShell(role);
  const canExecute = !roleCanExecute
    ? false
    : "can_execute_shell" in actor && typeof actor.can_execute_shell === "boolean"
      ? actor.can_execute_shell
      : true;

  const commandStr = typeof command === "string" ? command.trim() : command.join(" ").trim();
  const argv = typeof command === "string" ? command.trim().split(/\s+/) : command;
  const activePolicy = policy ?? loadRepoPolicy();

  // 1. Check Subshell and Chaining Escapes
  const subshellCheck = hasUnshieldedSubshellOrChaining(commandStr, argv);
  if (subshellCheck.detected) {
    return {
      authorized: false,
      error_code: "UNSHIELDED_COMMAND_BLUNDER",
      reason: subshellCheck.reason,
      message:
        `[UNSHIELDED_COMMAND_BLUNDER] Direct subshell invocation, evaluator, or command chaining blocked: '${commandStr}'.\n` +
        `All commands must be executed as direct argv arrays via: 'bun harness.ts shell --actor <agent_id> -- <command>'.\n` +
        `Subshells ('sh -c', 'bash -c', 'eval') and command chaining ('&&', '||', ';', '|') are strictly prohibited.`,
    };
  }

  // 2. Check Cognitive Validator & Non-Shell Roles Hard-Lock
  if (!canExecute) {
    return {
      authorized: false,
      error_code: "PERMISSION_DENIED",
      reason: `Role '${role}' has 'can_execute_shell: false'`,
      message:
        `[PERMISSION_DENIED] Role '${role}' has 'can_execute_shell: false'.\n` +
        `Cognitive Validators are strictly prohibited from running commands.\n` +
        `Focus exclusively on Socratic diff review and logic critique.`,
    };
  }

  // 3. Check Un-Targeted Test Suite Executions (Implementer / Worker)
  if (isUntargetedTestCommand(commandStr, argv, activePolicy)) {
    const targetedExample = activePolicy.test_runner?.targeted_pattern ?? "bun test <path>";
    return {
      authorized: false,
      error_code: "INVALID_SCOPE",
      reason: `Un-targeted whole-repo test run detected: '${commandStr}'`,
      message:
        `[INVALID_SCOPE] Un-targeted whole-repo test run detected: '${commandStr}'.\n` +
        `Implementers are forbidden from running full test suites.\n` +
        `You must pass a targeted file argument matching: '${targetedExample}'.`,
    };
  }

  // 4. Check Forbidden Regex Patterns
  const forbiddenPatterns = compileEffectiveForbiddenPatterns(role, activePolicy);
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(commandStr)) {
      return {
        authorized: false,
        error_code: "PERMISSION_DENIED",
        reason: `Command matched forbidden pattern: ${pattern.toString()}`,
        message: `[PERMISSION_DENIED] Command '${commandStr}' is prohibited for role '${role}'.`,
      };
    }
  }

  return { authorized: true };
}
