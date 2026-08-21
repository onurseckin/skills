import { findCommand } from "../cli/registry/index.ts";

export const placeholder = (label: string) => `<${label}>`;

export type ArgvFlag = readonly [name: string, value?: string];

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

export function pushArgv(into: string[][], argv: string[] | undefined): void {
  if (argv !== undefined) into.push(argv);
}
