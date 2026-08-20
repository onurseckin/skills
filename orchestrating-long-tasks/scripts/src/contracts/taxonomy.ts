import { isJsonObject, type JsonObject } from "./json.ts";

/**
 * The generic vocabulary that says WHAT KIND of thing a tool is. The tool's own name is a value
 * recorded beside the category, never a concept in this schema: a browser-automation runner is a
 * browser-automation runner whichever product produced it, and a category holds every field that is
 * true of the whole kind.
 */
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

/** The seed vocabulary. It is a starting point that grows, not a gate that rejects. */
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

/**
 * Open on purpose: a category nobody has seen before is a normal case. It is recorded as reported
 * and reaches the renderer intact, which treats it like any other unrecognised vocabulary member.
 */
export type ToolCategory = KnownToolCategory | (string & {});

const KNOWN_CATEGORIES = new Set<string>(TOOL_CATEGORIES);

/** Whether the seed vocabulary already names this category. An unknown one is still valid. */
export function isKnownToolCategory(value: unknown): value is KnownToolCategory {
  return typeof value === "string" && KNOWN_CATEGORIES.has(value);
}

/** Any non-blank string names a category, including one this vocabulary has never seen. */
export function isToolCategory(value: unknown): value is ToolCategory {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * The open bag beside a category: whatever one instance reported that nothing else in its category
 * would, kept under the name its reporter used so an unusual host loses nothing.
 */
export type CategoryExtras = JsonObject;

export function isCategoryExtras(value: unknown): value is CategoryExtras {
  return isJsonObject(value);
}
