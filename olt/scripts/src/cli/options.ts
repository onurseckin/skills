import { HarnessError } from "../core/errors/harness-error.ts";
import { suggestFlag, type FlagValue, type FlagValues } from "./arguments.ts";

export type Flags = Readonly<Record<string, FlagValues>>;

function occurrences(value: FlagValues): readonly FlagValue[] {
  return typeof value === "string" || value === true ? [value] : value;
}

function isMulti(value: FlagValues): boolean {
  return typeof value !== "string" && value !== true;
}

function given(flags: Flags, name: string): FlagValues | undefined {
  return Object.hasOwn(flags, name) ? flags[name] : undefined;
}

export interface CommandContext {
  stdin?: Uint8Array;
  executingRuntime?: string;
  inlinePrompt?: string;
}

export function assertFlags(flags: Flags, allowed: readonly string[]): void {
  const permitted = new Set(allowed);
  if (permitted.has("run")) permitted.add("run-id");
  if (permitted.has("run-id")) permitted.add("run");
  if (permitted.has("task")) permitted.add("task-id");
  if (permitted.has("task-id")) permitted.add("task");

  const unknown = Object.keys(flags).filter((name) => !permitted.has(name));
  if (unknown.length === 0) return;
  const target = unknown[0]!;
  const suggestion = suggestFlag(target, allowed);
  const hint = suggestion === undefined ? "" : `; did you mean ${suggestion.text}?`;
  throw new HarnessError(
    "INVALID_ARGUMENT",
    `unknown option: --${target}${hint}`,
    [],
    undefined,
    suggestion === undefined ? undefined : `replace --${target} with ${suggestion.text}`,
  );
}

export function textFlag(flags: Flags, name: string, required = true): string | undefined {
  let value = given(flags, name);
  if (value === undefined) {
    if (name === "run") value = given(flags, "run-id");
    else if (name === "run-id") value = given(flags, "run");
    else if (name === "task") value = given(flags, "task-id");
    else if (name === "task-id") value = given(flags, "task");
  }
  if (value === undefined && !required) return undefined;
  if (value !== undefined && isMulti(value)) {
    throw new HarnessError("INVALID_ARGUMENT", `--${name} is repeatable; read it as a list`);
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new HarnessError("INVALID_ARGUMENT", `--${name} must have a non-blank value`);
  }
  return value;
}

export function listFlag(
  flags: Flags,
  name: string,
  required = false,
): readonly string[] | undefined {
  const value = given(flags, name);
  if (value === undefined) {
    if (required) throw new HarnessError("INVALID_ARGUMENT", `--${name} is required`);
    return undefined;
  }
  const values = occurrences(value).map((entry) => {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new HarnessError("INVALID_ARGUMENT", `--${name} must have a non-blank value`);
    }
    return entry;
  });
  return values;
}

export function boolFlag(flags: Flags, name: string): boolean {
  const value = given(flags, name);
  if (value === undefined) return false;
  if (value !== true) throw new HarnessError("INVALID_ARGUMENT", `--${name} does not take a value`);
  return true;
}

export function integerFlag(
  flags: Flags,
  name: string,
  options: { required?: boolean; minimum?: number; maximum?: number } = {},
): number | undefined {
  const raw = textFlag(flags, name, options.required ?? false);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (
    !Number.isSafeInteger(value) ||
    value < (options.minimum ?? Number.MIN_SAFE_INTEGER) ||
    value > (options.maximum ?? Number.MAX_SAFE_INTEGER)
  ) {
    throw new HarnessError("INVALID_ARGUMENT", `--${name} must be a bounded integer`);
  }
  return value;
}

export function actorFlag(flags: Flags): string {
  return textFlag(flags, "actor")!;
}
