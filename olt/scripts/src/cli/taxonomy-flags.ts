import type { AgentToolRef } from "../core/contracts/index.ts";
import type { CategoryExtras } from "../core/contracts/index.ts";
import { TOOL_CATEGORIES } from "../core/contracts/index.ts";
import { HarnessError } from "../core/errors/index.ts";
import { listFlag, textFlag, type Flags } from "./options.ts";

export const CATEGORY_FLAG_HELP = `Generic category of the tool, e.g. ${TOOL_CATEGORIES.join(", ")}. Any other value is recorded as given.`;

function splitOnce(value: string, separator: string): [string, string] | undefined {
  const at = value.indexOf(separator);
  if (at <= 0 || at === value.length - 1) return undefined;
  return [value.slice(0, at), value.slice(at + 1)];
}

function requireSplit(
  flag: string,
  value: string,
  separator: string,
  shape: string,
): [string, string] {
  const parts = splitOnce(value, separator);
  if (!parts || !parts[0].trim() || !parts[1].trim()) {
    throw new HarnessError("INVALID_ARGUMENT", `--${flag} expects ${shape}, not "${value}"`);
  }
  return [parts[0].trim(), parts[1].trim()];
}

function parseToolExtras(flags: Flags): Map<string, CategoryExtras> {
  const extras = new Map<string, CategoryExtras>();
  for (const entry of listFlag(flags, "tool-extra") ?? []) {
    const [tool, rest] = requireSplit("tool-extra", entry, ":", "<tool>:<key>=<value>");
    const [key, value] = requireSplit("tool-extra", rest, "=", "<tool>:<key>=<value>");
    const bag = extras.get(tool) ?? {};
    if (Object.hasOwn(bag, key)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `--tool-extra names ${tool}:${key} twice; report each key once`,
      );
    }
    bag[key] = value;
    extras.set(tool, bag);
  }
  return extras;
}

export function toolRefFlags(flags: Flags): readonly AgentToolRef[] | undefined {
  const declared = listFlag(flags, "tool");
  const extras = parseToolExtras(flags);
  if (declared === undefined) {
    const orphan = [...extras.keys()][0];
    if (orphan !== undefined) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `--tool-extra names ${orphan}, which no --tool declared`,
      );
    }
    return undefined;
  }

  const refs = new Map<string, AgentToolRef>();
  for (const entry of declared) {
    let ref: AgentToolRef;
    if (entry.includes("=")) {
      const [name, category] = requireSplit("tool", entry, "=", "<name>[=<category>]");
      ref = { name, category };
    } else {
      ref = { name: entry.trim() };
    }
    if (refs.has(ref.name)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `--tool names ${ref.name} twice; declare each tool once`,
      );
    }
    refs.set(ref.name, ref);
  }

  for (const [tool, bag] of extras) {
    const ref = refs.get(tool);
    if (ref === undefined) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `--tool-extra names ${tool}, which no --tool declared`,
      );
    }
    refs.set(tool, { ...ref, extras: bag });
  }
  return [...refs.values()];
}

export function tokenExtraFlags(flags: Flags): Record<string, number> | undefined {
  const declared = listFlag(flags, "token-extra");
  if (declared === undefined) return undefined;
  const counters: Record<string, number> = {};
  for (const entry of declared) {
    const [name, raw] = requireSplit("token-extra", entry, "=", "<name>=<count>");
    if (Object.hasOwn(counters, name)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `--token-extra names ${name} twice; report each counter once`,
      );
    }
    const count = Number(raw);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `--token-extra ${name} must be a non-negative integer, not "${raw}"`,
      );
    }
    counters[name] = count;
  }
  return counters;
}

export interface DeclaredCommandTool {
  tool?: string;
  toolCategory?: string;
  toolExtras?: Record<string, string>;
}

export function declaredToolFlags(flags: Flags): DeclaredCommandTool {
  const tool = textFlag(flags, "tool", false);
  const toolCategory = textFlag(flags, "tool-category", false);
  const toolExtras: Record<string, string> = {};
  for (const entry of listFlag(flags, "tool-extra") ?? []) {
    const [key, value] = requireSplit("tool-extra", entry, "=", "<key>=<value>");
    if (Object.hasOwn(toolExtras, key)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `--tool-extra names ${key} twice; report each key once`,
      );
    }
    toolExtras[key] = value;
  }
  const hasExtras = Object.keys(toolExtras).length > 0;
  if (hasExtras && tool === undefined) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "--tool-extra describes a tool, so --tool is required",
    );
  }
  return {
    ...(tool === undefined ? {} : { tool }),
    ...(toolCategory === undefined ? {} : { toolCategory }),
    ...(hasExtras ? { toolExtras } : {}),
  };
}
