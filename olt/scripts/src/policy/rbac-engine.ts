import type { AgentMetadata } from "../runtime/agent-metadata.ts";
import { inferCanExecuteShell } from "../runtime/agent-metadata.ts";
import type { RepoPolicy } from "./repo-policy.ts";
import { loadRepoPolicy } from "./repo-policy.ts";
import { CODE_EDIT_TOOLS } from "../platform/code-edit-tools.ts";

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CODE_EDIT_TOOL_PATTERNS: readonly RegExp[] = [...CODE_EDIT_TOOLS].map(
  (name) => new RegExp(`\\b${escapeRegex(name)}\\b`, "i"),
);

export interface AuthorizationResult {
  readonly authorized: boolean;
  readonly error_code?:
    | "PERMISSION_DENIED"
    | "INVALID_SCOPE"
    | "UNSHIELDED_COMMAND_DEFECT"
    | string
    | undefined;
  readonly reason?: string | undefined;
  readonly message?: string | undefined;
}

export const STATIC_SUPERVISOR_FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /^git\s+(commit|push|reset|checkout\s+-b|merge|rebase)/i,
  ...CODE_EDIT_TOOL_PATTERNS,
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
    prefixTokens: ["gradlew", "test"],
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

interface CommandDispatch {
  readonly tokens: readonly string[];
  readonly denialReason?: string | undefined;
}

interface GitDispatchCheck {
  readonly errorCode: "PERMISSION_DENIED" | "UNSHIELDED_COMMAND_DEFECT";
  readonly reason: string;
}

const SHELL_EXECUTABLES = new Set(["sh", "bash", "zsh", "fish", "ksh", "csh", "tcsh", "dash"]);

const AMBIGUOUS_WRAPPERS = new Set([
  "command",
  "nohup",
  "nice",
  "timeout",
  "xargs",
  "find",
  "parallel",
  "setsid",
  "stdbuf",
  "ionice",
  "chronic",
  "daemonize",
]);

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "status",
  "diff",
  "show",
  "log",
  "grep",
  "ls-files",
  "rev-parse",
]);

const GIT_MUTATING_SUBCOMMANDS = new Set([
  "add",
  "am",
  "apply",
  "bisect",
  "branch",
  "checkout",
  "cherry-pick",
  "clean",
  "commit",
  "fetch",
  "merge",
  "mv",
  "pull",
  "push",
  "rebase",
  "reset",
  "restore",
  "rm",
  "stash",
  "switch",
  "tag",
  "update-ref",
  "worktree",
]);

function isOutputWritingGitOption(token: string): boolean {
  return token === "--output" || token.startsWith("--output=");
}

function normalizeExecutable(token: string): string {
  const basename = token.trim().split(/[\\/]/).pop() ?? "";
  return basename.replace(/\.exe$/i, "").toLowerCase();
}

function normalizeDispatchTokens(tokens: readonly string[]): readonly string[] {
  if (tokens.length === 0) return tokens;
  return [normalizeExecutable(tokens[0]!), ...tokens.slice(1)];
}

function isEnvironmentAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token);
}

function analyzeCommandDispatch(argv: readonly string[], depth = 0): CommandDispatch {
  if (depth > 4 || argv.length === 0 || !argv[0]?.trim()) {
    return { tokens: [], denialReason: "Command dispatch is empty or recursively wrapped." };
  }

  const tokens = normalizeDispatchTokens(argv);
  const executable = tokens[0]!;

  if (executable === "env") {
    let index = 1;
    while (index < tokens.length) {
      const token = tokens[index]!;
      if (token === "--") {
        index++;
        break;
      }
      if (token === "-S" || token.startsWith("--split-string")) {
        return { tokens, denialReason: "env split-string semantics are not authorized." };
      }
      if (token === "-i" || token === "--ignore-environment") {
        index++;
        continue;
      }
      if (token === "-u" || token === "--unset") {
        if (!tokens[index + 1] || tokens[index + 1]!.startsWith("-")) {
          return { tokens, denialReason: `env option '${token}' requires an environment name.` };
        }
        index += 2;
        continue;
      }
      if (token.startsWith("--unset=") && token.length > "--unset=".length) {
        index++;
        continue;
      }
      if (isEnvironmentAssignment(token)) {
        index++;
        continue;
      }
      if (token.startsWith("-")) {
        return { tokens, denialReason: `Unsupported env option '${token}' is ambiguous.` };
      }
      break;
    }

    if (index >= tokens.length) {
      return { tokens, denialReason: "env invocation does not contain a command." };
    }
    return analyzeCommandDispatch(tokens.slice(index), depth + 1);
  }

  if (AMBIGUOUS_WRAPPERS.has(executable)) {
    return {
      tokens,
      denialReason: `Wrapper '${executable}' has execution semantics that cannot be safely authorized.`,
    };
  }

  return { tokens };
}

function inspectGitDispatch(tokens: readonly string[]): GitDispatchCheck | undefined {
  if (tokens[0] !== "git") return undefined;

  let index = 1;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (token === "-C" || token === "--git-dir" || token === "--work-tree") {
      if (!tokens[index + 1] || tokens[index + 1]!.startsWith("-")) {
        return {
          errorCode: "UNSHIELDED_COMMAND_DEFECT",
          reason: `Git global option '${token}' requires a literal path value.`,
        };
      }
      index += 2;
      continue;
    }
    if (
      (token.startsWith("-C") && token.length > 2) ||
      (token.startsWith("--git-dir=") && token.length > "--git-dir=".length) ||
      (token.startsWith("--work-tree=") && token.length > "--work-tree=".length)
    ) {
      index++;
      continue;
    }
    if (token === "-c" || token.startsWith("-c") || token === "--config-env") {
      return {
        errorCode: "UNSHIELDED_COMMAND_DEFECT",
        reason: `Git configuration option '${token}' can activate aliases or extensions.`,
      };
    }
    if (token.startsWith("-")) {
      return {
        errorCode: "UNSHIELDED_COMMAND_DEFECT",
        reason: `Unsupported Git global option '${token}' is ambiguous.`,
      };
    }
    break;
  }

  const subcommand = tokens[index]?.toLowerCase();
  if (!subcommand) {
    return { errorCode: "UNSHIELDED_COMMAND_DEFECT", reason: "Git command has no subcommand." };
  }
  if (GIT_MUTATING_SUBCOMMANDS.has(subcommand)) {
    return {
      errorCode: "PERMISSION_DENIED",
      reason: `Git mutation '${subcommand}' is prohibited for constrained roles.`,
    };
  }
  if (!READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) {
    return {
      errorCode: "UNSHIELDED_COMMAND_DEFECT",
      reason: `Git extension or unrecognized subcommand '${subcommand}' is not authorized.`,
    };
  }
  if (tokens.slice(index + 1).some(isOutputWritingGitOption)) {
    return {
      errorCode: "UNSHIELDED_COMMAND_DEFECT",
      reason: `Git '${subcommand}' output redirection can write external files.`,
    };
  }
  return undefined;
}

function isKnownTestRunner(tokens: readonly string[]): boolean {
  return KNOWN_TEST_RUNNERS.some((runner) =>
    runner.prefixTokens.every((token, index) => tokens[index]?.toLowerCase() === token),
  );
}

export function hasUnshieldedSubshellOrChaining(
  _commandStr: string,
  argv: readonly string[],
): { detected: boolean; reason?: string } {
  const dispatch = analyzeCommandDispatch(argv);
  if (dispatch.denialReason) {
    return { detected: true, reason: dispatch.denialReason };
  }
  const tokens = dispatch.tokens;
  const firstToken = tokens[0] ?? "";

  if (SHELL_EXECUTABLES.has(firstToken)) {
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
    (firstToken === "node" || firstToken === "bun" || firstToken === "deno") &&
    tokens.some(
      (a) => a === "-e" || a === "--eval" || a.startsWith("-e=") || a.startsWith("--eval="),
    )
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
    tokens.some((a) => a === "-c" || a === "-e" || a.startsWith("-c=") || a.startsWith("-e="))
  ) {
    return {
      detected: true,
      reason: `Inline code evaluator detected: '${firstToken}'`,
    };
  }

  for (const arg of tokens) {
    if (arg === "&&" || arg === "||" || arg === ";" || arg === "|" || arg === "&") {
      return {
        detected: true,
        reason: `Command chaining operator detected in argv: '${arg}'`,
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
  const rawTokens = argvInput && argvInput.length > 0 ? argvInput : trimmed.split(/\s+/);
  const dispatch = analyzeCommandDispatch(rawTokens);
  if (dispatch.denialReason) return false;
  const tokens = dispatch.tokens;
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

const regexCache = new Map<string, RegExp[]>();

export function compileEffectiveForbiddenPatterns(role: string, policy?: RepoPolicy): RegExp[] {
  const normalizedRole = role.trim().toLowerCase();
  const activePolicy = policy ?? loadRepoPolicy();
  const forbiddenCommandsStr = activePolicy.forbidden_commands
    ? activePolicy.forbidden_commands.join(",")
    : "";
  const cacheKey = `${normalizedRole}:${forbiddenCommandsStr}`;

  if (regexCache.has(cacheKey)) {
    return regexCache.get(cacheKey)!;
  }

  let patterns: RegExp[];

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
    patterns = [/.*/];
  }

  // Supervisors
  else if (
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
    patterns = supervisorPatterns;
  }

  // Mechanic Validators: Can run typechecks, AST static audits, tests; cannot mutate git or source files
  else if (
    normalizedRole === "mechanic-validator" ||
    normalizedRole === "mechanic_validator" ||
    normalizedRole === "sub-validator" ||
    normalizedRole === "sub_validator"
  ) {
    patterns = [
      /^git\s+(commit|push|reset|checkout(\s+-b)?|merge|rebase)/i,
      ...CODE_EDIT_TOOL_PATTERNS,
      /^bun\s+harness.*task:review/i,
      /^bun\s+harness.*run:complete/i,
    ];
  }

  // Implementers / Repairers / Workers
  else {
    const implementerPatterns: RegExp[] = [...STATIC_IMPLEMENTER_FORBIDDEN_PATTERNS];

    if (activePolicy.forbidden_commands) {
      for (const cmd of activePolicy.forbidden_commands) {
        implementerPatterns.push(new RegExp(`^${escapeRegex(cmd)}`, "i"));
      }
    }
    patterns = implementerPatterns;
  }

  regexCache.set(cacheKey, patterns);
  return patterns;
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
  const normalizedRole = role.toLowerCase();
  const roleCanExecute = inferCanExecuteShell(role);
  const canExecute = !roleCanExecute
    ? false
    : "can_execute_shell" in actor && typeof actor.can_execute_shell === "boolean"
      ? actor.can_execute_shell
      : true;

  const commandStr = typeof command === "string" ? command.trim() : command.join(" ").trim();
  const rawArgv = typeof command === "string" ? command.trim().split(/\s+/) : command;
  const dispatch = analyzeCommandDispatch(rawArgv);
  if (dispatch.denialReason) {
    return {
      authorized: false,
      error_code: "UNSHIELDED_COMMAND_DEFECT",
      reason: dispatch.denialReason,
      message:
        `[UNSHIELDED_COMMAND_DEFECT] Command dispatch could not be safely normalized: '${commandStr}'.\n` +
        `Wrappers and ambiguous command forms are prohibited unless their nested argv is fully parsed and authorized.`,
    };
  }
  const argv = dispatch.tokens;
  const normalizedCommandStr = argv.join(" ");
  const activePolicy = policy ?? loadRepoPolicy();

  const isCognitiveValidator =
    normalizedRole === "validator" ||
    normalizedRole === "cognitive-validator" ||
    normalizedRole === "cognitive_validator" ||
    normalizedRole.startsWith("validator-") ||
    normalizedRole === "critic" ||
    normalizedRole === "completeness-critic" ||
    normalizedRole === "completeness_critic" ||
    normalizedRole === "plan-validator" ||
    normalizedRole === "plan_validator" ||
    normalizedRole === "sub-investigator" ||
    normalizedRole === "sub_investigator";

  const isSupervisor =
    normalizedRole === "mind" ||
    normalizedRole === "orchestrator" ||
    normalizedRole === "coordinator" ||
    normalizedRole === "meta-auditor" ||
    normalizedRole === "meta_auditor" ||
    normalizedRole === "mind-auditor" ||
    normalizedRole === "mind_auditor";

  // 1. Check Subshell and Chaining Escapes
  const subshellCheck = hasUnshieldedSubshellOrChaining(normalizedCommandStr, argv);
  if (subshellCheck.detected) {
    return {
      authorized: false,
      error_code: "UNSHIELDED_COMMAND_DEFECT",
      reason: subshellCheck.reason,
      message:
        `[UNSHIELDED_COMMAND_DEFECT] Direct subshell invocation, evaluator, or command chaining blocked: '${commandStr}'.\n` +
        `All commands must be executed as direct argv arrays via: 'bun harness.ts shell --actor <agent_id> -- <command>'.\n` +
        `Subshells ('sh -c', 'bash -c', 'eval') and command chaining ('&&', '||', ';', '|') are strictly prohibited.`,
    };
  }

  // 2. Check Cognitive Validator Hard-Lock
  if (isCognitiveValidator) {
    return {
      authorized: false,
      error_code: "COGNITIVE_VALIDATOR_COMMAND_FORBIDDEN",
      reason: `Role '${role}' has 'can_execute_shell: false'`,
      message:
        `[COGNITIVE_VALIDATOR_COMMAND_FORBIDDEN] Cognitive Validators are locked to 0 command execution.\n` +
        `Focus exclusively on Socratic diff review and logic critique.`,
    };
  }

  // 3. Supervisor strict ban on tests
  const isTestCommand = isKnownTestRunner(argv) || /\.(test|spec)\.[a-z0-9]+$/i.test(argv[0] ?? "");
  if (isSupervisor && isTestCommand) {
    return {
      authorized: false,
      error_code: "SUPERVISOR_TEST_EXECUTION_FORBIDDEN",
      reason: `Supervisors cannot run tests: '${commandStr}'`,
      message: `[SUPERVISOR_TEST_EXECUTION_FORBIDDEN] Coordinators and Orchestrators are mechanically blocked from running test commands.`,
    };
  }

  // 4. General !canExecute check (if they are a supervisor but running non-test command, or other non-exec roles)
  if (!canExecute) {
    return {
      authorized: false,
      error_code: "PERMISSION_DENIED",
      reason: `Role '${role}' has 'can_execute_shell: false'`,
      message:
        `[PERMISSION_DENIED] Role '${role}' has 'can_execute_shell: false'.\n` +
        `This role is strictly prohibited from running commands.`,
    };
  }

  // 5. Check Un-Targeted Test Suite Executions (Implementer / Worker)
  if (isUntargetedTestCommand(normalizedCommandStr, argv, activePolicy)) {
    const targetedExample = activePolicy.test_runner?.targeted_pattern ?? "bun test <path>";
    return {
      authorized: false,
      error_code: "UNBOUNDED_TEST_RUNNER_FORBIDDEN",
      reason: `Un-targeted whole-repo test run detected: '${commandStr}'`,
      message:
        `[UNBOUNDED_TEST_RUNNER_FORBIDDEN] Un-targeted whole-repo test run detected: '${commandStr}'.\n` +
        `Implementers are forbidden from running full test suites.\n` +
        `You must pass a targeted file argument matching: '${targetedExample}'.`,
    };
  }

  // 6. Parse git globally before string policy matching so options cannot hide mutations.
  const gitCheck = inspectGitDispatch(argv);
  if (gitCheck) {
    return {
      authorized: false,
      error_code: gitCheck.errorCode,
      reason: gitCheck.reason,
      message: `[${gitCheck.errorCode}] Command '${commandStr}' is prohibited for role '${role}': ${gitCheck.reason}`,
    };
  }

  // 7. Check Forbidden Regex Patterns against normalized dispatch tokens.
  const forbiddenPatterns = compileEffectiveForbiddenPatterns(role, activePolicy);
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(normalizedCommandStr)) {
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
