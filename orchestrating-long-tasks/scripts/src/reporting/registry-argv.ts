import { findCommand } from "../cli/registry/index.ts";

/** A hole the reader has to fill. It is never a value the harness pretends to have recorded. */
export const placeholder = (label: string) => `<${label}>`;

/** `[flag, value]`; the value is omitted for bool flags and for holes the run cannot fill. */
export type ArgvFlag = readonly [name: string, value?: string];

/**
 * The only way this package is allowed to name a command. Both the command and every flag are
 * resolved against COMMAND_REGISTRY, so a handoff can never print an invocation the CLI would
 * reject: a name the registry does not know, a flag the spec does not declare, or a `--` tail on a
 * command that takes none yields nothing at all rather than a line that fails when it is pasted.
 * Required flags the caller did not supply render as placeholders, which read as holes rather than
 * as something the harness observed.
 */
export function registryArgv(
  entrypoint: string,
  invocation: string,
  flags: readonly ArgvFlag[] = [],
  remainder: readonly string[] = [],
): string[] | undefined {
  const spec = findCommand(invocation);
  if (spec === undefined) return undefined;
  if (remainder.length > 0 && !spec.takesRemainder) return undefined;
  const argv = ["bun", entrypoint, spec.name];
  const supplied = new Set<string>();
  for (const [name, value] of flags) {
    const flag = spec.flags.find((entry) => entry.name === name);
    if (flag === undefined) return undefined;
    supplied.add(flag.name);
    argv.push(`--${flag.name}`);
    if (flag.type !== "bool") argv.push(value ?? placeholder(`${flag.name}-for:${spec.name}`));
  }
  for (const flag of spec.flags) {
    if (!flag.required || supplied.has(flag.name)) continue;
    argv.push(`--${flag.name}`);
    if (flag.type !== "bool") argv.push(placeholder(`${flag.name}-for:${spec.name}`));
  }
  return remainder.length === 0 ? argv : [...argv, "--", ...remainder];
}

/** Keeps only what the registry resolved: an invocation it could not build is never printed. */
export function pushArgv(into: string[][], argv: string[] | undefined): void {
  if (argv !== undefined) into.push(argv);
}
