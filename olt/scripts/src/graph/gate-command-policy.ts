import { isNonblank } from "../requirements/predicates.ts";
import { directTestCommandIsWeak, hasNonProofMode, hasUnsafeOperands } from "./gate-argv-policy.ts";
import { runtimeCommandIsStrong } from "./gate-runtime-grammar.ts";
import { verificationToolCommandIsStrong } from "./gate-tool-grammar.ts";

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

function executableName(value: string): string {
  return (value.replaceAll("\\", "/").split("/").at(-1) ?? value).toLowerCase();
}

function isBareExecutable(value: string): boolean {
  return !value.includes("/") && !value.includes("\\");
}

function commandArgv(value: unknown): string[] | null {
  if (isNonblank(value)) return [value.trim()];
  if (!Array.isArray(value) || value.length === 0 || !value.every(isNonblank)) return [];
  if (value.length > MAX_GATE_ARGV) return null;
  return value.map((part) => part.trim());
}

function unwrapCommand(argv: readonly string[]): string[] | null {
  let index = 1;
  while (index < argv.length) {
    const value = argv[index]!;
    if (value === "--") return argv.slice(index + 1);
    if (value === "-v" || value === "-V" || /^-[p]*[vV]/u.test(value)) return null;
    if (value === "-p" || /^-p+$/u.test(value)) index += 1;
    else if (value.startsWith("-")) return null;
    else break;
  }
  return argv.slice(index);
}

function unwrapEnv(argv: readonly string[]): string[] | null {
  const args = argv.slice(1);
  if (args[0] === "--") return args.slice(1);
  if ((args[0] ?? "").startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/u.test(args[0] ?? ""))
    return null;
  return [...args];
}

function normalizeWrappers(argv: readonly string[]): string[] | null {
  let current = [...argv];
  while (current.length > 0) {
    if (!isBareExecutable(current[0]!)) return current;
    const executable = executableName(current[0]!).replace(/\.exe$/u, "");
    if (executable !== "command" && executable !== "env") return current;
    const next = executable === "command" ? unwrapCommand(current) : unwrapEnv(current);
    if (next === null || next.length >= current.length) return null;
    current = next;
  }
  return null;
}

function forbiddenExecutable(executable: string): boolean {
  const family = executable.replace(/\.exe$/u, "");
  return (
    NOOP_EXECUTABLES.has(family) ||
    MULTICALL_EXECUTABLES.has(family) ||
    SHELL_EXECUTABLES.has(executable) ||
    SHELL_EXECUTABLES.has(family)
  );
}

function reservedExecutable(executable: string): boolean {
  const family = executable.replace(/\.exe$/u, "");
  return (
    forbiddenExecutable(executable) ||
    TRUSTED_EXECUTABLES.has(family) ||
    /^(?:python|pypy|ruby|perl|php)\d+(?:\.\d+)*$/u.test(family)
  );
}

export function commandIsWeak(value: unknown): boolean {
  const raw = commandArgv(value);
  if (raw === null) return true;
  if (raw.length === 0) return false;
  if (typeof value === "string" && /\s/u.test(value.trim())) return true;
  const argv = normalizeWrappers(raw);
  if (argv === null) return true;
  if (hasUnsafeOperands(argv)) return true;
  if (!isBareExecutable(argv[0]!)) {
    if (reservedExecutable(executableName(argv[0]!))) return true;
    return !verificationToolCommandIsStrong(argv[0]!, argv);
  }
  const executable = executableName(argv[0]!);
  if (forbiddenExecutable(executable)) return true;
  const directTestResult = directTestCommandIsWeak(executable, argv);
  if (directTestResult !== null) return directTestResult;
  if (hasNonProofMode(argv)) return true;
  const runtimeResult = runtimeCommandIsStrong(executable, argv);
  if (runtimeResult !== null) return !runtimeResult;
  return !verificationToolCommandIsStrong(executable, argv);
}
