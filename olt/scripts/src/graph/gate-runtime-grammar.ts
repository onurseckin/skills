import { isRepoRelativePath } from "../requirements/predicates.ts";
import { hasOpaquePathOption } from "./gate-argv-policy.ts";

const NODE_TEST_FLAGS = new Set(["--experimental-test-coverage"]);
const BUN_TEST_FLAGS = new Set(["--bail", "--concurrent", "--coverage", "--randomize"]);
const DENO_FLAGS = new Set([
  "--allow-env",
  "--allow-read",
  "--allow-run",
  "--fail-fast",
  "--quiet",
]);
const PYTHON_TEST_FLAGS = new Set(["--failfast", "--quiet", "--verbose", "-q", "-v", "-x"]);

function hasExtension(value: string, extensions: readonly string[]): boolean {
  return (
    !value.startsWith("-") &&
    isRepoRelativePath(value) &&
    extensions.some((extension) => value.endsWith(extension))
  );
}

function fileBackedCommand(args: readonly string[], extensions: readonly string[]): boolean {
  return hasExtension(args[0] ?? "", extensions) && !hasOpaquePathOption(args);
}

function testTarget(
  value: string,
  extensions: readonly string[],
  allowDirectory: boolean,
): boolean {
  if (!isRepoRelativePath(value)) return false;
  const basename = value.split("/").at(-1) ?? value;
  return (
    (allowDirectory && !basename.includes(".")) ||
    extensions.some((extension) => value.endsWith(extension))
  );
}

function safeFlag(
  value: string,
  exact: ReadonlySet<string>,
  valuedNames: readonly string[],
): boolean {
  if (exact.has(value)) return true;
  return valuedNames.some((name) => value.startsWith(`${name}=`) && value.length > name.length + 1);
}

function explicitTargets(
  args: readonly string[],
  extensions: readonly string[],
  exactFlags: ReadonlySet<string>,
  valuedFlags: readonly string[],
  allowDirectory = true,
): boolean {
  const targets: string[] = [];
  for (const value of args) {
    if (value.startsWith("-")) {
      if (!safeFlag(value, exactFlags, valuedFlags)) return false;
    } else targets.push(value);
  }
  return (
    targets.length > 0 && targets.every((value) => testTarget(value, extensions, allowDirectory))
  );
}

function nodeCommand(args: readonly string[]): boolean {
  if (args[0] !== "--test") return fileBackedCommand(args, [".js", ".mjs", ".cjs", ".ts"]);
  return explicitTargets(args.slice(1), [".js", ".mjs", ".cjs", ".ts"], NODE_TEST_FLAGS, [
    "--test-concurrency",
    "--test-reporter",
    "--test-timeout",
  ]);
}

function bunCommand(args: readonly string[]): boolean {
  if (fileBackedCommand(args, [".js", ".ts"])) return true;
  if (args[0] === "test")
    return explicitTargets(args.slice(1), [".js", ".jsx", ".ts", ".tsx"], BUN_TEST_FLAGS, [
      "--bail",
      "--rerun-each",
      "--seed",
      "--timeout",
    ]);
  if (args[0] !== "run") return false;
  const script = args[1] ?? "";
  return (
    args.length === 2 &&
    /^[A-Za-z0-9][A-Za-z0-9:_-]*$/u.test(script) &&
    !["env", "help", "version"].includes(script)
  );
}

function denoCommand(args: readonly string[]): boolean {
  if (args[0] !== "run" && args[0] !== "test") return false;
  return explicitTargets(
    args.slice(1),
    [".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"],
    DENO_FLAGS,
    ["--allow-env", "--allow-read", "--allow-run", "--coverage"],
    args[0] === "test",
  );
}

function pythonCommand(args: readonly string[]): boolean {
  if (args[0] !== "-m") return fileBackedCommand(args, [".py"]);
  if (args[1] !== "pytest" && args[1] !== "unittest") return false;
  return explicitTargets(args.slice(2), [".py"], PYTHON_TEST_FLAGS, ["--maxfail"]);
}

export function runtimeCommandIsStrong(
  executable: string,
  argv: readonly string[],
): boolean | null {
  const family = executable.replace(/\.exe$/u, "");
  const args = argv.slice(1);
  if (family === "node") return nodeCommand(args);
  if (family === "bun") return bunCommand(args);
  if (family === "deno") return denoCommand(args);
  if (/^(?:python(?:\d+(?:\.\d+)*)?|pypy(?:\d+(?:\.\d+)*)?)$/u.test(family))
    return pythonCommand(args);
  if (/^ruby(?:\d+(?:\.\d+)*)?$/u.test(family)) return fileBackedCommand(args, [".rb"]);
  if (/^perl(?:\d+(?:\.\d+)*)?$/u.test(family)) return fileBackedCommand(args, [".pl"]);
  if (/^php(?:\d+(?:\.\d+)*)?$/u.test(family)) return fileBackedCommand(args, [".php"]);
  return null;
}
