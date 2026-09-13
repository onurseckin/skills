import { isNonblank } from "../requirements/predicates.ts";
import {
  directTestCommandIsWeak,
  hasNonProofMode,
  hasUnsafeOperands,
  unsafeOperand,
} from "./gate-argv-policy.ts";
import { runtimeCommandIsStrong } from "./gate-runtime-grammar.ts";
import { verificationToolCommandIsStrong } from "./gate-tool-grammar.ts";

export const PERMITTED_RUNNERS_LIST =
  "Permitted runners: bun, bun run, node, npm test, local script in scripts/check/";

export interface GatePolicyDiagnostic {
  readonly rule: string;
  readonly message: string;
  readonly permittedRunners: string;
  readonly suggestedReplacement: string;
  readonly diagnostic: string;
}

const MAX_GATE_ARGV = 256;
const NOOP_EXECUTABLES = new Set([":", "echo", "exit", "false", "printf", "true"]);
const MULTICALL_EXECUTABLES = new Set(["busybox", "toybox"]);
const TRUSTED_EXECUTABLES = new Set([
  "[",
  "biome",
  "bun",
  "cargo",
  "command",
  "deno",
  "dotnet",
  "env",
  "eslint",
  "git",
  "go",
  "jest",
  "node",
  "npm",
  "oxfmt",
  "oxlint",
  "perl",
  "php",
  "pnpm",
  "prettier",
  "pypy",
  "python",
  "pytest",
  "ruby",
  "test",
  "tsc",
  "vitest",
  "yarn",
]);
const SHELL_EXECUTABLES = new Set([
  "ash",
  "bash",
  "cmd",
  "cmd.exe",
  "command.com",
  "csh",
  "dash",
  "fish",
  "ksh",
  "nu",
  "powershell",
  "powershell.exe",
  "pwsh",
  "sh",
  "tcsh",
  "zsh",
]);

const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn"]);

const NON_PROOF_FLAG_SET = new Set([
  "--allow-no-tests",
  "--allownotests",
  "--collect-only",
  "--collectonly",
  "--dry-run",
  "--dryrun",
  "--help",
  "--if-present",
  "--ignore-scripts",
  "--list",
  "--list-tests",
  "--listtests",
  "--no-error-on-unmatched-pattern",
  "--no-run",
  "--pass-with-no-tests",
  "--passwithnotests",
  "--version",
  "--watch",
  "--watch-all",
  "--watchall",
  "dry-run",
  "dryrun",
  "help",
  "list",
  "version",
  "watch",
]);

function executableName(value: string): string {
  const parts = value.replaceAll("\\", "/").split("/");
  const last = parts.at(-1);
  const selected = typeof last === "string" && last.length > 0 ? last : value;
  return selected.toLowerCase();
}

function isBareExecutable(value: string): boolean {
  if (value.includes("/")) return false;
  if (value.includes("\\")) return false;
  return true;
}

function commandArgv(value: unknown): string[] | null {
  if (isNonblank(value)) return [value.trim()];
  if (!Array.isArray(value)) return [];
  if (value.length === 0) return [];
  if (!value.every(isNonblank)) return [];
  if (value.length > MAX_GATE_ARGV) return null;
  return value.map((part) => part.trim());
}

function unwrapCommand(argv: readonly string[]): string[] | null {
  let index = 1;
  while (index < argv.length) {
    const value = argv[index];
    if (typeof value !== "string") break;
    if (value === "--") return argv.slice(index + 1);
    if (value === "-v") return null;
    if (value === "-V") return null;
    if (/^-[p]*[vV]/u.test(value)) return null;
    if (value === "-p") index += 1;
    else if (/^-p+$/u.test(value)) index += 1;
    else if (value.startsWith("-")) return null;
    else break;
  }
  return argv.slice(index);
}

function unwrapEnv(argv: readonly string[]): string[] | null {
  const args = argv.slice(1);
  if (args.length === 0) return [];
  const first = args[0];
  if (first === "--") return args.slice(1);
  if (typeof first === "string") {
    if (first.startsWith("-")) return null;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(first)) return null;
  }
  return [...args];
}

function normalizeWrappers(argv: readonly string[]): string[] | null {
  let current = [...argv];
  while (current.length > 0) {
    const head = current[0];
    if (typeof head !== "string") return null;
    if (!isBareExecutable(head)) return current;
    const executable = executableName(head).replace(/\.exe$/u, "");
    if (executable !== "command" && executable !== "env") return current;
    const next = executable === "command" ? unwrapCommand(current) : unwrapEnv(current);
    if (next === null) return null;
    if (next.length >= current.length) return null;
    current = next;
  }
  return null;
}

function forbiddenExecutable(executable: string): boolean {
  const family = executable.replace(/\.exe$/u, "");
  if (NOOP_EXECUTABLES.has(family)) return true;
  if (MULTICALL_EXECUTABLES.has(family)) return true;
  if (SHELL_EXECUTABLES.has(executable)) return true;
  if (SHELL_EXECUTABLES.has(family)) return true;
  return false;
}

function reservedExecutable(executable: string): boolean {
  const family = executable.replace(/\.exe$/u, "");
  if (forbiddenExecutable(executable)) return true;
  if (TRUSTED_EXECUTABLES.has(family)) return true;
  if (/^(?:python|pypy|ruby|perl|php)\d+(?:\.\d+)*$/u.test(family)) return true;
  return false;
}

function makeDiagnostic(
  rule: string,
  message: string,
  suggestedReplacement: string,
): GatePolicyDiagnostic {
  const diagnostic = `${rule}: ${message}\n${PERMITTED_RUNNERS_LIST}\nSuggested replacement command: ${suggestedReplacement}`;
  return {
    rule,
    message,
    permittedRunners: PERMITTED_RUNNERS_LIST,
    suggestedReplacement,
    diagnostic,
  };
}

function findNonProofFlag(argv: readonly string[]): string {
  for (const value of argv.slice(1)) {
    if (value.startsWith("-h")) return value;
    if (value.startsWith("-V")) return value;
    const parts = value.split("=", 1);
    const modeKey = parts[0];
    if (typeof modeKey === "string") {
      const mode = modeKey.toLowerCase();
      if (NON_PROOF_FLAG_SET.has(mode)) return value;
    }
  }
  const dashArg = argv.slice(1).find((v) => v.startsWith("-"));
  if (typeof dashArg === "string") return dashArg;
  const secondArg = argv[1];
  if (typeof secondArg === "string") return secondArg;
  return "";
}

function cleanNonProofCommand(argv: readonly string[]): string {
  const first = argv[0];
  const head = typeof first === "string" ? first : "";
  const cleaned = [
    head,
    ...argv.slice(1).filter((value) => {
      if (value.startsWith("-h")) return false;
      if (value.startsWith("-V")) return false;
      const parts = value.split("=", 1);
      const modeKey = parts[0];
      if (typeof modeKey === "string") {
        const mode = modeKey.toLowerCase();
        return !NON_PROOF_FLAG_SET.has(mode);
      }
      return true;
    }),
  ];
  if (cleaned.length === 1) {
    const c0 = cleaned[0];
    if (c0 === "node") return "node test tests/";
    if (c0 === "bun") return "bun test tests/";
    if (c0 === "deno") return "deno test tests/";
  }
  return cleaned.join(" ");
}

function suggestBunxReplacement(argv: readonly string[]): string {
  const sub = argv[1];
  if (typeof sub !== "string") return "bun test";
  if (sub.length === 0) return "bun test";
  if (sub === "test") {
    const rest = argv.slice(2).join(" ").trim();
    return rest.length > 0 ? `bun test ${rest}` : "bun test";
  }
  if (sub === "vitest") {
    const targets = argv.slice(2).join(" ").trim();
    return targets.length > 0 ? `bun test ${targets}` : "bun test";
  }
  if (sub === "jest") {
    const targets = argv.slice(2).join(" ").trim();
    return targets.length > 0 ? `bun test ${targets}` : "bun test";
  }
  return `bun run ${argv.slice(1).join(" ")}`.trim();
}

function suggestDynamicRunnerReplacement(executable: string, argv: readonly string[]): string {
  if (executable === "bunx") return suggestBunxReplacement(argv);
  if (argv.length > 1) {
    const runner = executable === "pnpx" ? "pnpm" : "npm";
    return `${runner} run ${argv.slice(1).join(" ")}`.trim();
  }
  return "npm test";
}

export function diagnoseCommandPolicy(value: unknown): GatePolicyDiagnostic | null {
  const raw = commandArgv(value);
  if (raw === null) {
    if (Array.isArray(value)) {
      if (value.length > MAX_GATE_ARGV) {
        return makeDiagnostic(
          "COMMAND_ARGV_LIMIT_EXCEEDED",
          `Gate command argv length exceeds maximum allowed limit (${MAX_GATE_ARGV})`,
          "bun test",
        );
      }
    }
    return makeDiagnostic(
      "INVALID_COMMAND_SYNTAX",
      "Gate command must be a non-blank string or non-empty string array",
      "bun test",
    );
  }
  if (raw.length === 0) return null;
  if (typeof value === "string") {
    if (/\s/u.test(value.trim())) {
      const parts = value.trim().split(/\s+/u);
      const suggested = JSON.stringify(parts);
      return makeDiagnostic(
        "UNTOKENIZED_COMMAND_STRING",
        "String commands with whitespace are forbidden in gate commands; provide an argv array of arguments instead",
        suggested,
      );
    }
  }
  const argv = normalizeWrappers(raw);
  if (argv === null) {
    const firstRaw = raw[0];
    const wrapper = typeof firstRaw === "string" ? firstRaw : "command";
    return makeDiagnostic(
      "INVALID_COMMAND_WRAPPER",
      `Invalid '${wrapper}' wrapper invocation in gate command`,
      "bun test",
    );
  }
  const unsafe = unsafeOperand(argv);
  if (unsafe !== null) {
    return makeDiagnostic(
      "UNSAFE_OPERAND_PATH",
      `Operand '${unsafe}' must be a repository-relative path (absolute, parent-traversal, UNC, and device paths rejected)`,
      "Ensure all file paths are repository-relative without '..' traversal",
    );
  }
  const firstArg = argv[0];
  if (typeof firstArg !== "string") {
    return makeDiagnostic(
      "INVALID_COMMAND_SYNTAX",
      "Gate command executable is invalid",
      "bun test",
    );
  }
  if (!isBareExecutable(firstArg)) {
    const exec = executableName(firstArg);
    if (reservedExecutable(exec)) {
      return makeDiagnostic(
        "RESERVED_EXECUTABLE_PATH_QUALIFIED",
        `Path-qualified invocation of reserved executable '${exec}' is forbidden; use bare runner or repository-local script`,
        `${exec} ${argv.slice(1).join(" ")}`.trim(),
      );
    }
    if (!verificationToolCommandIsStrong(firstArg, argv)) {
      return makeDiagnostic(
        "INVALID_REPO_LOCAL_EXECUTABLE",
        `Repository-local script '${firstArg}' must be a valid executable file in repository (e.g. in scripts/check/) without leading dash arguments`,
        `./scripts/check ${argv.slice(1).join(" ")}`.trim(),
      );
    }
    return null;
  }
  const executable = executableName(firstArg);
  if (executable === "bunx") {
    return makeDiagnostic(
      "PROHIBITED_RUNNER_BUNX",
      "'bunx' dynamic package resolution is forbidden in gate commands",
      suggestBunxReplacement(argv),
    );
  }
  if (executable === "npx") {
    return makeDiagnostic(
      "PROHIBITED_RUNNER_NPX",
      "'npx' dynamic package resolution is forbidden in gate commands",
      suggestDynamicRunnerReplacement(executable, argv),
    );
  }
  if (executable === "pnpx") {
    return makeDiagnostic(
      "PROHIBITED_RUNNER_PNPX",
      "'pnpx' dynamic package resolution is forbidden in gate commands",
      suggestDynamicRunnerReplacement(executable, argv),
    );
  }
  const family = executable.replace(/\.exe$/u, "");
  if (NOOP_EXECUTABLES.has(family)) {
    return makeDiagnostic(
      "PROHIBITED_NOOP_EXECUTABLE",
      `'${executable}' is a no-op executable and performs no verification`,
      "bun test",
    );
  }
  if (MULTICALL_EXECUTABLES.has(family)) {
    return makeDiagnostic(
      "PROHIBITED_MULTICALL_EXECUTABLE",
      `'${executable}' multicall binary wrapper is forbidden in gate commands`,
      "bun test",
    );
  }
  const isShell = SHELL_EXECUTABLES.has(executable) ? true : SHELL_EXECUTABLES.has(family);
  if (isShell) {
    const shellScript = argv.slice(1).find((arg) => arg.endsWith(".sh"));
    const suggested = typeof shellScript === "string" ? shellScript : "bun test";
    return makeDiagnostic(
      "PROHIBITED_SHELL_EXECUTABLE",
      `'${executable}' shell interpreter is forbidden in gate commands; execute verification tools directly`,
      suggested,
    );
  }
  const directTestResult = directTestCommandIsWeak(executable, argv);
  if (directTestResult !== null) {
    if (directTestResult) {
      return makeDiagnostic(
        "INVALID_TEST_PREDICATE",
        `'${executable}' command requires a valid repository file predicate (-f, -d, -e, etc.) and repository-relative target`,
        `${executable} -f <file>`,
      );
    }
    return null;
  }
  if (hasNonProofMode(argv)) {
    const flag = findNonProofFlag(argv);
    return makeDiagnostic(
      "NON_PROOF_MODE_FLAG",
      `Non-proof mode or bypass flag '${flag}' is forbidden in gate commands`,
      cleanNonProofCommand(argv),
    );
  }
  const runtimeResult = runtimeCommandIsStrong(executable, argv);
  if (runtimeResult !== null) {
    if (!runtimeResult) {
      let suggested = `${executable} test`;
      if (executable === "bun") {
        suggested =
          argv[1] === "test"
            ? "bun test tests/"
            : argv[1] === "run"
              ? "bun run verify"
              : "bun test tests/";
      } else if (executable === "node") {
        suggested = argv.includes("--test")
          ? "node --test tests/check.test.js"
          : "node scripts/check.ts";
      } else if (executable === "deno") {
        suggested = "deno test tests/check_test.ts";
      } else if (family.startsWith("python")) {
        suggested = "python3 -m pytest tests";
      } else if (family.startsWith("pypy")) {
        suggested = "python3 -m pytest tests";
      } else if (family.startsWith("ruby")) {
        suggested = "ruby scripts/check.rb";
      }
      return makeDiagnostic(
        "INVALID_RUNTIME_INVOCATION",
        `'${executable}' invocation does not match substantive verification grammar`,
        suggested,
      );
    }
    return null;
  }
  if (verificationToolCommandIsStrong(executable, argv)) {
    return null;
  }
  if (executable === "git") {
    return makeDiagnostic(
      "INVALID_TOOL_INVOCATION",
      "'git' gate command only permits 'git diff --check' or 'git diff --cached --check'",
      "git diff --check",
    );
  }
  if (["cargo", "dotnet", "go"].includes(family)) {
    const suggested = family === "go" ? "go test ./..." : `${family} test`;
    return makeDiagnostic(
      "INVALID_TOOL_INVOCATION",
      `'${executable}' command does not match substantive verification grammar`,
      suggested,
    );
  }
  if (["jest", "pytest", "vitest"].includes(family)) {
    const suggested =
      family === "vitest" ? "vitest run tests/check.test.ts" : `${family} tests/check.test.ts`;
    return makeDiagnostic(
      "INVALID_TOOL_INVOCATION",
      `'${executable}' command requires explicit test target files`,
      suggested,
    );
  }
  if (["biome", "eslint", "oxlint"].includes(family)) {
    return makeDiagnostic(
      "INVALID_TOOL_INVOCATION",
      `'${executable}' command requires target file/directory`,
      `${executable} src/`,
    );
  }
  if (["oxfmt", "prettier"].includes(family)) {
    return makeDiagnostic(
      "INVALID_TOOL_INVOCATION",
      `'${executable}' command requires '--check' and target paths`,
      `${executable} --check src/`,
    );
  }
  if (family === "tsc") {
    return makeDiagnostic(
      "INVALID_TOOL_INVOCATION",
      "'tsc' command requires '--noEmit'",
      "tsc --noEmit",
    );
  }
  if (PACKAGE_MANAGERS.has(family)) {
    return makeDiagnostic(
      "INVALID_PACKAGE_MANAGER_INVOCATION",
      `'${executable}' command requires 'test', 'lint', 'build', or 'run <script>'`,
      `${executable} test`,
    );
  }
  return makeDiagnostic(
    "PROHIBITED_RUNNER_UNKNOWN",
    `'${executable}' is not a permitted gate runner or verification tool`,
    "bun test",
  );
}

export function commandIsWeak(value: unknown): boolean {
  return diagnoseCommandPolicy(value) !== null;
}
