import { existsSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import type { CommandPathBinding } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { commandHasTestIntent } from "./output-evidence.ts";

const PATH_EXTENSION =
  /\.(?:cjs|cts|go|js|jsx|json|mjs|mts|php|pl|py|rb|rs|sh|toml|ts|tsx|txt|yaml|yml)$/iu;
const INTERPRETERS = new Set([
  "bash",
  "bun",
  "deno",
  "node",
  "perl",
  "php",
  "python",
  "python3",
  "ruby",
  "sh",
  "zsh",
]);
const CONFIG_NAMES = new Set([
  "-p",
  "--config",
  "--config-path",
  "--configuration",
  "--ignore-path",
  "--project",
  "--setup-file",
  "--setup-files",
]);

function optionName(value: string): string {
  return value.split("=", 1)[0]!.toLowerCase();
}

export function configOperand(argv: readonly string[], index: number): boolean {
  return (
    CONFIG_NAMES.has(optionName(argv[index] ?? "")) ||
    CONFIG_NAMES.has(optionName(argv[index - 1] ?? ""))
  );
}

export function pathOperand(
  argument: string,
  cwd: string,
  executable: boolean,
): string | undefined {
  const equals = argument.startsWith("-") ? argument.indexOf("=") : -1;
  const operand = equals > 0 ? argument.slice(equals + 1) : argument;
  if (!operand || (argument.startsWith("-") && equals < 0)) return undefined;
  if (operand === "./...") return undefined;
  // commented out
  if (isAbsolute(operand) || operand.includes("\\"))
    throw new HarnessError("PATH_SAFETY", `gate path operand is unsafe: ${operand}`);
  if (executable && !operand.startsWith(".") && !operand.includes("/")) return undefined;
  return operand.startsWith(".") ||
    operand.includes("/") ||
    PATH_EXTENSION.test(operand) ||
    existsSync(resolve(cwd, operand))
    ? operand
    : undefined;
}

export function pathRole(
  argv: readonly string[],
  index: number,
  cwd: string,
  effectiveIndex: number,
  executableIndices: ReadonlySet<number>,
): CommandPathBinding["role"] {
  if (executableIndices.has(index)) return "executable";
  if (configOperand(argv, index)) return "config";
  const effective = argv.slice(effectiveIndex);
  if (commandHasTestIntent(effective)) return "target";
  const family = basename(effective[0] ?? "")
    .toLowerCase()
    .replace(/\.exe$/u, "");
  if (!INTERPRETERS.has(family)) return "target";
  const firstProgram = argv.findIndex(
    (value, position) =>
      position > effectiveIndex &&
      !value.startsWith("-") &&
      !executableIndices.has(position) &&
      !configOperand(argv, position) &&
      pathOperand(value, cwd, false) !== undefined,
  );
  return index === firstProgram ? "program" : "target";
}
