import { HarnessError } from "../core/errors/index.ts";

export type FlagValue = string | true;
export type FlagValues = FlagValue | readonly FlagValue[];

export interface FlagShape {
  readonly takesValue: boolean;
  readonly repeatable: boolean;
}

export type FlagShapes = ReadonlyMap<string, FlagShape>;

export interface ParsedArguments {
  command: string;
  flags: Record<string, FlagValues>;
  remainder: string[];
}

const ALWAYS_VALUED: readonly string[] = ["run", "repo", "task", "actor"];

const FLAG_NAME = /^[a-z][a-z0-9-]*$/;

const MAX_SUGGESTED_FLAGS = 2;

export interface FlagSuggestion {
  readonly names: readonly string[];
  readonly text: string;
}

function levenshteinDistance(source: string, target: string): number {
  const rows = source.length + 1;
  const cols = target.length + 1;
  const distances = new Array<number>(rows * cols);
  for (let row = 0; row < rows; row += 1) distances[row * cols] = row;
  for (let col = 0; col < cols; col += 1) distances[col] = col;
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const substitutionCost = source[row - 1] === target[col - 1] ? 0 : 1;
      distances[row * cols + col] = Math.min(
        distances[(row - 1) * cols + col]! + 1,
        distances[row * cols + col - 1]! + 1,
        distances[(row - 1) * cols + col - 1]! + substitutionCost,
      );
    }
  }
  return distances[(rows - 1) * cols + (cols - 1)]!;
}

function formatAlternatives(values: readonly string[]): string {
  if (values.length === 1) return values[0]!;
  if (values.length === 2) return `${values[0]} or ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, or ${values[values.length - 1]}`;
}

export function nearestFlagNames(
  flagName: string,
  candidates: readonly string[],
): readonly string[] {
  const prefixed = candidates
    .filter((candidate) => candidate !== flagName && candidate.startsWith(flagName))
    .sort(
      (a, b) =>
        levenshteinDistance(flagName, a) - levenshteinDistance(flagName, b) || a.localeCompare(b),
    );
  if (prefixed.length > 0) return prefixed.slice(0, MAX_SUGGESTED_FLAGS);

  const ranked = candidates
    .map((candidate) => ({ candidate, distance: levenshteinDistance(flagName, candidate) }))
    .sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate));
  const nearest = ranked[0];
  if (nearest === undefined) return [];
  const threshold = Math.max(1, Math.floor(flagName.length / 2));
  if (nearest.distance > threshold) return [];
  return ranked
    .filter((entry) => entry.distance <= threshold)
    .slice(0, MAX_SUGGESTED_FLAGS)
    .map((entry) => entry.candidate);
}

export function suggestFlag(
  flagName: string,
  candidates: readonly string[],
): FlagSuggestion | undefined {
  const names = nearestFlagNames(flagName, candidates);
  if (names.length === 0) return undefined;
  return { names, text: formatAlternatives(names.map((name) => `--${name}`)) };
}

function takesValue(name: string, shapes: FlagShapes | undefined): boolean {
  const shape = shapes?.get(name);
  return shape === undefined ? ALWAYS_VALUED.includes(name) : shape.takesValue;
}

function consumesFollowing(
  name: string,
  following: string | undefined,
  shapes: FlagShapes | undefined,
): boolean {
  if (following === undefined || following === "--") return false;
  if (!following.startsWith("--")) return true;
  if (shapes === undefined || !takesValue(name, shapes)) return false;
  return !shapes.has(following.slice(2));
}

export function parseArguments(argv: readonly string[], shapes?: FlagShapes): ParsedArguments {
  const [command, ...tokens] = argv;
  if (!command?.trim() || command.startsWith("-")) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "a command is required",
      [],
      undefined,
      "run `harness.ts help` to see every command",
    );
  }
  const singles: Record<string, FlagValue> = {};
  const repeats: Record<string, FlagValue[]> = {};
  const remainder: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token === "--") {
      remainder.push(...tokens.slice(index + 1));
      break;
    }
    if (!token.startsWith("--")) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `unexpected positional argument: ${token}`,
        [],
        undefined,
        "prefix it with -- to name a flag, or move it after a literal -- if a child command should receive it",
      );
    }
    const name = token.slice(2);
    if (!FLAG_NAME.test(name)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `invalid option: ${token}`,
        [],
        undefined,
        "flag names must match --[a-z][a-z0-9-]*, e.g. --run-id",
      );
    }
    const following = tokens[index + 1];
    let value: FlagValue = true;
    if (consumesFollowing(name, following, shapes)) {
      value = following!;
      index += 1;
    } else if (following === undefined && takesValue(name, shapes)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `option --${name} requires a value`,
        [],
        undefined,
        `pass a value, e.g. --${name} <value>`,
      );
    }
    if (shapes?.get(name)?.repeatable === true) {
      (repeats[name] ??= []).push(value);
      continue;
    }
    if (Object.hasOwn(singles, name)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `duplicate option: --${name}`,
        [],
        undefined,
        `pass --${name} once`,
      );
    }
    singles[name] = value;
  }
  return { command, flags: { ...singles, ...repeats }, remainder };
}

export function flagPositions(tokens: readonly string[], shapes?: FlagShapes): string[] {
  const names: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token === "--") break;
    if (!token.startsWith("--")) continue;
    const name = token.slice(2);
    names.push(name);
    if (consumesFollowing(name, tokens[index + 1], shapes)) index += 1;
  }
  return names;
}
