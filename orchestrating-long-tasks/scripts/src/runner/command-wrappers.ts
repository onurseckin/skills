import { basename } from "node:path";

export interface CommandLayers {
  executableIndices: number[];
  effectiveIndex: number;
  valid: boolean;
}

function family(value: string): string {
  return basename(value)
    .toLowerCase()
    .replace(/\.exe$/u, "");
}

function commandTarget(argv: readonly string[], index: number): number | undefined {
  let cursor = index + 1;
  while (cursor < argv.length) {
    const value = argv[cursor]!;
    if (value === "--") return cursor + 1 < argv.length ? cursor + 1 : undefined;
    if (value === "-p" || /^-p+$/u.test(value)) cursor += 1;
    else if (value.startsWith("-")) return undefined;
    else return cursor;
  }
  return undefined;
}

function envTarget(argv: readonly string[], index: number): number | undefined {
  const cursor = index + 1;
  if (argv[cursor] === "--") return cursor + 1 < argv.length ? cursor + 1 : undefined;
  const value = argv[cursor] ?? "";
  return value && !value.startsWith("-") && !/^[A-Za-z_][A-Za-z0-9_]*=/u.test(value)
    ? cursor
    : undefined;
}

export function commandLayers(argv: readonly string[]): CommandLayers {
  if (argv.length === 0) return { executableIndices: [], effectiveIndex: 0, valid: false };
  const executableIndices = [0];
  let current = 0;
  while (true) {
    const wrapper = family(argv[current] ?? "");
    if (wrapper !== "command" && wrapper !== "env") break;
    const next = wrapper === "command" ? commandTarget(argv, current) : envTarget(argv, current);
    if (next === undefined) return { executableIndices, effectiveIndex: current, valid: false };
    executableIndices.push(next);
    current = next;
  }
  return { executableIndices, effectiveIndex: current, valid: true };
}

export function effectiveCommandArgv(argv: readonly string[]): readonly string[] {
  const layers = commandLayers(argv);
  return layers.valid ? argv.slice(layers.effectiveIndex) : argv;
}
