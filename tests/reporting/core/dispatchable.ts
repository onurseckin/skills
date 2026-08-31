import { parseArguments } from "../../../olt/scripts/src/cli/arguments.ts";
import { assertFlags } from "../../../olt/scripts/src/cli/options.ts";
import { findCommand, flagShapes } from "../../../olt/scripts/src/cli/registry/index.ts";

/**
 * Runs an emitted argv through exactly the checks `execute` applies before dispatch: the command
 * has to be in the registry, every flag has to be one the spec declares, every required flag has to
 * be there, and a `--` tail is only allowed where the spec takes one. A handoff line that fails any
 * of these is a line that fails when a fresh agent pastes it.
 */
export function dispatchFailure(argv: readonly string[]): string | undefined {
  const [runtime, , invocation] = argv;
  if (runtime !== "bun") return `argv does not start with bun: ${argv.join(" ")}`;
  if (invocation === undefined) return `argv names no command: ${argv.join(" ")}`;
  const spec = findCommand(invocation);
  if (spec === undefined) return `no registry command named ${invocation}`;
  const parsed = parseArguments(argv.slice(2), flagShapes(spec.flags));
  if (parsed.remainder.length > 0 && !spec.takesRemainder) {
    return `${invocation} does not accept -- arguments`;
  }
  try {
    assertFlags(
      parsed.flags,
      spec.flags.map((flag) => flag.name),
    );
  } catch (error) {
    return `${invocation}: ${error instanceof Error ? error.message : String(error)}`;
  }
  const missing = spec.flags.find(
    (flag) => flag.required && !Object.hasOwn(parsed.flags, flag.name),
  );
  return missing === undefined ? undefined : `${invocation} is missing --${missing.name}`;
}

export function dispatchFailures(commands: readonly (readonly string[])[]): string[] {
  return commands
    .map((argv) => dispatchFailure(argv))
    .filter((failure): failure is string => failure !== undefined);
}

/** Every `["bun", ...]` JSON line the rendered handoff prints under its argv heading. */
export function handoffArgv(document: string): string[][] {
  const section = document.slice(document.indexOf("## Exact next argv"));
  return section
    .split("\n")
    .filter((line) => line.startsWith('["bun"'))
    .map((line) => JSON.parse(line) as string[]);
}
