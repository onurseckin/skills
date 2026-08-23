import { isRepoRelativePath } from "../requirements/predicates.ts";
import { hasDashPrefixedArgument, isRepoLocalExecutable } from "./gate-argv-policy.ts";

const SAFE_TARGET_FLAGS = new Set(["--", "--coverage", "--quiet", "--runInBand", "-q", "-v", "-x"]);
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn"]);

function safeTarget(value: string): boolean {
  return value === "." || value === "./..." || isRepoRelativePath(value, true);
}

function explicitTestTarget(value: string): boolean {
  return (
    safeTarget(value) &&
    (value.includes("/") || /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/u.test(value))
  );
}

function safeFlag(value: string, exact: ReadonlySet<string>, valued: readonly string[]): boolean {
  if (exact.has(value)) return true;
  return valued.some((name) => value.startsWith(`${name}=`) && value.length > name.length + 1);
}

function flagsAndTargets(
  args: readonly string[],
  exact: ReadonlySet<string>,
  valued: readonly string[],
  requireTarget: boolean,
  targetPredicate: (value: string) => boolean = safeTarget,
): boolean {
  const targets: string[] = [];
  for (const value of args) {
    if (value.startsWith("-")) {
      if (!safeFlag(value, exact, valued)) return false;
    } else targets.push(value);
  }
  return (!requireTarget || targets.length > 0) && targets.every(targetPredicate);
}

function gitCommand(args: readonly string[]): boolean {
  return (
    args[0] === "diff" &&
    (args.length === 2
      ? args[1] === "--check"
      : args.length === 3 && args[1] === "--cached" && args[2] === "--check")
  );
}

function compiledTestCommand(executable: string, args: readonly string[]): boolean {
  if (args[0] !== "test") return false;
  if (executable === "cargo") {
    const options = args.slice(1);
    const targeted = options.some(
      (value) =>
        ["--all-targets", "--benches", "--bins", "--lib", "--tests", "--workspace"].includes(
          value,
        ) || /^(?:--package|--test)=\S+$/u.test(value),
    );
    return (
      targeted &&
      flagsAndTargets(
        options,
        new Set([
          "--all-features",
          "--all-targets",
          "--benches",
          "--bins",
          "--lib",
          "--locked",
          "--no-fail-fast",
          "--release",
          "--tests",
          "--workspace",
        ]),
        ["--features", "--jobs", "--package", "--profile", "--target", "--test"],
        false,
        () => false,
      )
    );
  }
  if (executable === "go")
    return flagsAndTargets(
      args.slice(1),
      new Set(["-cover", "-race", "-v"]),
      ["-shuffle", "-vet"],
      true,
    );
  return flagsAndTargets(
    args.slice(1),
    new Set(["--no-build", "--no-restore"]),
    ["--configuration", "--framework", "--runtime"],
    false,
  );
}

function directTestRunner(executable: string, args: readonly string[]): boolean {
  if (executable === "vitest") {
    if (args[0] !== "run") return false;
    return flagsAndTargets(
      args.slice(1),
      SAFE_TARGET_FLAGS,
      ["--config"],
      true,
      explicitTestTarget,
    );
  }
  if (executable === "jest")
    return flagsAndTargets(
      args,
      SAFE_TARGET_FLAGS,
      ["--config", "--maxWorkers"],
      true,
      explicitTestTarget,
    );
  return flagsAndTargets(args, SAFE_TARGET_FLAGS, ["--config", "--maxfail"], false);
}

function lintCommand(executable: string, args: readonly string[]): boolean {
  if (executable === "biome") {
    if (args[0] !== "check") return false;
    return flagsAndTargets(
      args.slice(1),
      new Set(["--error-on-warnings"]),
      ["--config-path"],
      true,
    );
  }
  return flagsAndTargets(
    args,
    new Set(["--deny-warnings", "--no-warn-ignored", "--quiet", "--type-aware"]),
    ["--config", "--max-warnings"],
    true,
  );
}

function formatterCommand(args: readonly string[]): boolean {
  return (
    args[0] === "--check" &&
    flagsAndTargets(
      args.slice(1),
      new Set(["--ignore-unknown"]),
      ["--config", "--ignore-path"],
      true,
    )
  );
}

function tscCommand(args: readonly string[]): boolean {
  if (!args.includes("--noEmit")) return false;
  return flagsAndTargets(
    args,
    new Set(["--incremental", "--noEmit", "--pretty", "-p"]),
    ["--incremental", "--pretty", "--project"],
    false,
  );
}

function packageCommand(args: readonly string[]): boolean {
  const mode = args[0] ?? "";
  if (["build", "lint", "test"].includes(mode)) return args.length === 1;
  if (mode !== "run") return false;
  const script = args[1] ?? "";
  return (
    args.length === 2 &&
    /^[A-Za-z0-9][A-Za-z0-9:_-]*$/u.test(script) &&
    !["env", "help", "version"].includes(script)
  );
}

export function verificationToolCommandIsStrong(
  executable: string,
  argv: readonly string[],
): boolean {
  const family = executable.replace(/\.exe$/u, "");
  const args = argv.slice(1);
  if (family === "git") return gitCommand(args);
  if (["cargo", "dotnet", "go"].includes(family)) return compiledTestCommand(family, args);
  if (["jest", "pytest", "vitest"].includes(family)) return directTestRunner(family, args);
  if (["biome", "eslint", "oxlint"].includes(family)) return lintCommand(family, args);
  if (["oxfmt", "prettier"].includes(family)) return formatterCommand(args);
  if (family === "tsc") return tscCommand(args);
  if (PACKAGE_MANAGERS.has(family)) return packageCommand(args);
  return isRepoLocalExecutable(argv[0]!) && !hasDashPrefixedArgument(argv);
}
