import { HarnessError } from "../errors/harness-error.ts";

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
    throw new HarnessError("INVALID_ARGUMENT", "a command is required");
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
      throw new HarnessError("INVALID_ARGUMENT", `unexpected positional argument: ${token}`);
    }
    const name = token.slice(2);
    if (!FLAG_NAME.test(name)) {
      throw new HarnessError("INVALID_ARGUMENT", `invalid option: ${token}`);
    }
    const following = tokens[index + 1];
    let value: FlagValue = true;
    if (consumesFollowing(name, following, shapes)) {
      value = following!;
      index += 1;
    } else if (following === undefined && takesValue(name, shapes)) {
      throw new HarnessError("INVALID_ARGUMENT", `option --${name} requires a value`);
    }
    if (shapes?.get(name)?.repeatable === true) {
      (repeats[name] ??= []).push(value);
      continue;
    }
    if (Object.hasOwn(singles, name)) {
      throw new HarnessError("INVALID_ARGUMENT", `duplicate option: --${name}`);
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
