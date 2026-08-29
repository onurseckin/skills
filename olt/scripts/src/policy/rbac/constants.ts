import { CODE_EDIT_TOOLS } from "../../platform/index.ts";

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const CODE_EDIT_TOOL_PATTERNS: readonly RegExp[] = [...CODE_EDIT_TOOLS].map(
  (name) => new RegExp(`\\b${escapeRegex(name)}\\b`, "i"),
);

export interface AuthorizationResult {
  readonly authorized: boolean;
  readonly error_code?:
    | "PERMISSION_DENIED"
    | "INVALID_SCOPE"
    | "UNSHIELDED_COMMAND_DEFECT"
    | "COGNITIVE_VALIDATOR_COMMAND_FORBIDDEN"
    | "SUPERVISOR_TEST_EXECUTION_FORBIDDEN"
    | "UNBOUNDED_TEST_RUNNER_FORBIDDEN"
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

export const SHELL_EXECUTABLES: ReadonlySet<string> = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "ksh",
  "csh",
  "tcsh",
  "dash",
]);

export const AMBIGUOUS_WRAPPERS: ReadonlySet<string> = new Set([
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

export const READ_ONLY_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "status",
  "diff",
  "show",
  "log",
  "grep",
  "ls-files",
  "rev-parse",
]);

export const GIT_MUTATING_SUBCOMMANDS: ReadonlySet<string> = new Set([
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
