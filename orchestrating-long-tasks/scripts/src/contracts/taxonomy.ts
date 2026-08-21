import { isJsonObject, type JsonObject } from "./json.ts";

export type KnownToolCategory =
  | "browser-automation"
  | "build"
  | "database"
  | "documentation"
  | "file-edit"
  | "formatter"
  | "http-client"
  | "linter"
  | "package-manager"
  | "search"
  | "shell"
  | "test-runner"
  | "type-checker"
  | "version-control";

export const TOOL_CATEGORIES: readonly KnownToolCategory[] = [
  "browser-automation",
  "build",
  "database",
  "documentation",
  "file-edit",
  "formatter",
  "http-client",
  "linter",
  "package-manager",
  "search",
  "shell",
  "test-runner",
  "type-checker",
  "version-control",
];

export type ToolCategory = KnownToolCategory | (string & {});

const KNOWN_CATEGORIES = new Set<string>(TOOL_CATEGORIES);

export function isKnownToolCategory(value: unknown): value is KnownToolCategory {
  return typeof value === "string" && KNOWN_CATEGORIES.has(value);
}

export function isToolCategory(value: unknown): value is ToolCategory {
  return typeof value === "string" && value.trim().length > 0;
}

export type CategoryExtras = JsonObject;

export function isCategoryExtras(value: unknown): value is CategoryExtras {
  return isJsonObject(value);
}
