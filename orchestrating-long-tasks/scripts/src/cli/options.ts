import { HarnessError } from "../errors/harness-error.ts";
import type { FlagValue } from "./arguments.ts";

export type Flags = Readonly<Record<string, FlagValue>>;

export function assertFlags(flags: Flags, allowed: readonly string[]): void {
  const permitted = new Set(allowed);
  const unknown = Object.keys(flags).filter((name) => !permitted.has(name));
  if (unknown.length) throw new HarnessError("INVALID_ARGUMENT", `unknown option: --${unknown[0]}`);
}

export function textFlag(flags: Flags, name: string, required = true): string | undefined {
  const value = flags[name];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new HarnessError("INVALID_ARGUMENT", `--${name} must have a non-blank value`);
  }
  return value;
}

export function boolFlag(flags: Flags, name: string): boolean {
  const value = flags[name];
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
