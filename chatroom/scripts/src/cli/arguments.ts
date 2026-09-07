import {
  CliError,
  flagShapes,
  type CommandSpec,
  type FlagShapes,
  type FlagValue,
  type FlagValues,
} from "./registry/index.ts";

export interface ParsedArguments {
  command: string;
  flags: Record<string, FlagValues>;
  remainder: readonly string[];
}

export interface FlagSuggestion {
  readonly names: readonly string[];
  readonly text: string;
}

const FLAG_NAME = /^[a-z][a-z0-9-]*$/;
const MAX_SUGGESTED_FLAGS = 2;

function levenshteinDistance(source: string, target: string): number {
  const rows = source.length + 1;
  const cols = target.length + 1;
  const distances = Array.from<number>({ length: rows * cols });
  for (let row = 0; row < rows; row += 1) {
    distances[row * cols] = row;
  }
  for (let col = 0; col < cols; col += 1) {
    distances[col] = col;
  }
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const substitutionCost = source[row - 1] === target[col - 1] ? 0 : 1;
      const deletion = (distances[(row - 1) * cols + col] ?? 0) + 1;
      const insertion = (distances[row * cols + col - 1] ?? 0) + 1;
      const substitution = (distances[(row - 1) * cols + col - 1] ?? 0) + substitutionCost;
      distances[row * cols + col] = Math.min(deletion, insertion, substitution);
    }
  }
  return distances[(rows - 1) * cols + (cols - 1)] ?? 0;
}

function formatAlternatives(values: readonly string[]): string {
  if (values.length === 1) {
    return values[0] ?? "";
  }
  if (values.length === 2) {
    return `${values[0]} or ${values[1]}`;
  }
  return `${values.slice(0, -1).join(", ")}, or ${values[values.length - 1]}`;
}

export function nearestFlagNames(
  flagName: string,
  candidates: readonly string[],
): readonly string[] {
  const prefixed = candidates
    .filter((candidate) => candidate !== flagName && candidate.startsWith(flagName))
    .sort(
      (left, right) =>
        levenshteinDistance(flagName, left) - levenshteinDistance(flagName, right) ||
        left.localeCompare(right),
    );
  if (prefixed.length > 0) {
    return prefixed.slice(0, MAX_SUGGESTED_FLAGS);
  }

  const ranked = candidates
    .map((candidate) => ({ candidate, distance: levenshteinDistance(flagName, candidate) }))
    .sort(
      (left, right) =>
        left.distance - right.distance || left.candidate.localeCompare(right.candidate),
    );
  const nearest = ranked[0];
  if (nearest === undefined) {
    return [];
  }
  const threshold = Math.max(1, Math.floor(flagName.length / 2));
  if (nearest.distance > threshold) {
    return [];
  }
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
  if (names.length === 0) {
    return undefined;
  }
  return { names, text: formatAlternatives(names.map((name) => `--${name}`)) };
}

export function suggestCommand(
  commandName: string,
  candidates: readonly string[],
): string | undefined {
  const prefixed = candidates
    .filter((candidate) => candidate !== commandName && candidate.startsWith(commandName))
    .sort(
      (left, right) =>
        levenshteinDistance(commandName, left) - levenshteinDistance(commandName, right) ||
        left.localeCompare(right),
    );
  if (prefixed.length > 0 && prefixed[0] !== undefined) {
    return prefixed[0];
  }

  const ranked = candidates
    .map((candidate) => ({ candidate, distance: levenshteinDistance(commandName, candidate) }))
    .sort(
      (left, right) =>
        left.distance - right.distance || left.candidate.localeCompare(right.candidate),
    );
  const nearest = ranked[0];
  if (nearest === undefined) {
    return undefined;
  }
  const threshold = Math.max(2, Math.floor(commandName.length / 2));
  if (nearest.distance > threshold) {
    return undefined;
  }
  return nearest.candidate;
}

function takesValue(name: string, shapes: FlagShapes | undefined): boolean {
  const shape = shapes?.get(name);
  if (shape !== undefined) {
    return shape.takesValue;
  }
  return false;
}

function consumesFollowing(
  name: string,
  following: string | undefined,
  shapes: FlagShapes | undefined,
): boolean {
  if (following === undefined || following === "--") {
    return false;
  }
  if (shapes !== undefined && shapes.has(name) && !takesValue(name, shapes)) {
    return false;
  }
  if (!following.startsWith("--")) {
    return true;
  }
  if (shapes === undefined || !takesValue(name, shapes)) {
    return false;
  }
  if (following.includes(" ")) {
    return true;
  }
  const flagCandidate = following.includes("=")
    ? following.slice(2, following.indexOf("="))
    : following.slice(2);
  return !shapes.has(flagCandidate);
}

export function splitCommandLine(line: string): string[] {
  const args: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let escape = false;
  let hasToken = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (escape) {
      current += char;
      hasToken = true;
      escape = false;
      continue;
    }

    if (char === "\\") {
      escape = true;
      continue;
    }

    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      hasToken = true;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      hasToken = true;
      continue;
    }

    if ((char === " " || char === "\t" || char === "\n") && !inSingle && !inDouble) {
      if (hasToken) {
        args.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }

    current += char;
    hasToken = true;
  }

  if (hasToken) {
    args.push(current);
  }

  return args;
}

function isCommandSpec(candidate: unknown): candidate is CommandSpec {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    "name" in candidate &&
    "flags" in candidate &&
    "takesRemainder" in candidate
  );
}

function resolveCommandTokens(
  spec: CommandSpec,
  rawTokens: readonly string[],
): { command: string; tokens: readonly string[] } {
  if (rawTokens.length === 0) {
    return { command: spec.name, tokens: [] };
  }
  const first = rawTokens[0] ?? "";
  const second = rawTokens[1];
  if (
    first === "chat" &&
    second !== undefined &&
    (`${first}:${second}` === spec.name || spec.aliases.includes(second))
  ) {
    return { command: `${first} ${second}`, tokens: rawTokens.slice(2) };
  }
  if (first === spec.name || spec.aliases.includes(first) || first.startsWith("chat:")) {
    return { command: first, tokens: rawTokens.slice(1) };
  }
  return { command: spec.name, tokens: rawTokens };
}

export function parseArguments(spec: CommandSpec, argv: readonly string[]): ParsedArguments;
export function parseArguments(argv: readonly string[], shapes?: FlagShapes): ParsedArguments;
export function parseArguments(
  first: CommandSpec | readonly string[],
  second?: readonly string[] | FlagShapes,
): ParsedArguments {
  let command: string;
  let tokens: readonly string[];
  let shapes: FlagShapes | undefined;
  let spec: CommandSpec | undefined;

  if (isCommandSpec(first)) {
    spec = first;
    shapes = flagShapes(first.flags);
    const rawTokens = Array.isArray(second) ? second : [];
    const resolved = resolveCommandTokens(first, rawTokens);
    command = resolved.command;
    tokens = resolved.tokens;
  } else {
    const [commandToken, ...restTokens] = first;
    if (!commandToken?.trim() || commandToken.startsWith("-")) {
      throw new CliError("INVALID_ARGUMENT", "a command is required", 3);
    }
    command = commandToken;
    tokens = restTokens;
    shapes = second instanceof Map ? second : undefined;
  }

  const singles: Record<string, FlagValue> = {};
  const repeats: Record<string, FlagValue[]> = {};
  const remainder: string[] = [];
  let seenSeparator = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) {
      continue;
    }
    if (seenSeparator) {
      remainder.push(token);
      continue;
    }
    if (token === "--") {
      seenSeparator = true;
      continue;
    }
    if (!token.startsWith("--")) {
      if (spec !== undefined && !spec.takesRemainder) {
        throw new CliError("INVALID_ARGUMENT", `unexpected positional argument: ${token}`, 3);
      }
      remainder.push(token);
      continue;
    }
    let name: string;
    let value: FlagValue = true;
    if (token.includes("=")) {
      const eqIndex = token.indexOf("=");
      name = token.slice(2, eqIndex);
      const inlineValue = token.slice(eqIndex + 1);
      if (!FLAG_NAME.test(name)) {
        throw new CliError("INVALID_ARGUMENT", `invalid option: ${token}`, 3);
      }
      if (shapes !== undefined && !takesValue(name, shapes)) {
        if (inlineValue === "true") {
          value = true;
        } else {
          throw new CliError("INVALID_ARGUMENT", `option --${name} does not take a value`, 3);
        }
      } else {
        value = inlineValue;
      }
    } else {
      name = token.slice(2);
      if (!FLAG_NAME.test(name)) {
        throw new CliError("INVALID_ARGUMENT", `invalid option: ${token}`, 3);
      }
      const following = tokens[index + 1];
      if (consumesFollowing(name, following, shapes)) {
        value = following ?? "";
        index += 1;
      } else if (following === undefined && takesValue(name, shapes)) {
        throw new CliError("INVALID_ARGUMENT", `option --${name} requires a value`, 3);
      }
    }

    if (shapes?.get(name)?.repeatable === true) {
      const existing = repeats[name] ?? [];
      repeats[name] = [...existing, value];
      continue;
    }

    if (Object.hasOwn(singles, name)) {
      throw new CliError("INVALID_ARGUMENT", `duplicate option: --${name}`, 3);
    }
    singles[name] = value;
  }

  return { command, flags: { ...singles, ...repeats }, remainder };
}

export function flagPositions(tokens: readonly string[], shapes?: FlagShapes): string[] {
  const names: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined || token === "--") {
      break;
    }
    if (!token.startsWith("--")) {
      continue;
    }
    if (token.includes("=")) {
      const name = token.slice(2, token.indexOf("="));
      names.push(name);
    } else {
      const name = token.slice(2);
      names.push(name);
      if (consumesFollowing(name, tokens[index + 1], shapes)) {
        index += 1;
      }
    }
  }
  return names;
}
