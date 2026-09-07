import { parseArguments, suggestCommand } from "./arguments.ts";
import { assertFlags } from "./options.ts";
import {
  CliError,
  commandInvocations,
  findCommand,
  flagShapes,
  type CommandContext,
} from "./registry/index.ts";

export async function executeCommand(
  argv: readonly string[],
  context: CommandContext = {},
): Promise<Record<string, unknown>> {
  let effectiveArgv = [...argv];
  const first = effectiveArgv[0];
  const second = effectiveArgv[1];

  if (
    effectiveArgv.length >= 2 &&
    first !== undefined &&
    second !== undefined &&
    !first.startsWith("-") &&
    !second.startsWith("-") &&
    second !== "--"
  ) {
    const subCandidate = `${first}:${second}`;
    if (findCommand(subCandidate) !== undefined) {
      effectiveArgv = [subCandidate, ...effectiveArgv.slice(2)];
    }
  }

  const cmdName = effectiveArgv[0] ?? "";
  const spec = findCommand(cmdName);
  if (spec === undefined) {
    const suggestions = commandInvocations();
    const hintCommand = suggestCommand(cmdName, suggestions);
    const hint = hintCommand !== undefined ? `; did you mean '${hintCommand}'?` : "";
    throw new CliError("INVALID_ARGUMENT", `unknown command: ${cmdName}${hint}`, 3);
  }

  const parsed = parseArguments(spec, effectiveArgv);

  if (parsed.remainder.length > 0 && !spec.takesRemainder) {
    throw new CliError(
      "INVALID_ARGUMENT",
      `unexpected positional argument: ${parsed.remainder[0]}`,
      3,
    );
  }

  assertFlags(
    parsed.flags,
    spec.flags.map((flag) => flag.name),
  );

  const missing = spec.flags.find(
    (flag) => flag.required && !Object.hasOwn(parsed.flags, flag.name),
  );
  if (missing !== undefined) {
    throw new CliError("INVALID_ARGUMENT", `--${missing.name} is required`, 3);
  }

  const result = await spec.handler(parsed.flags, context, parsed.remainder);
  return result;
}
