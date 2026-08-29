import type { JsonObject } from "../core/contracts/index.ts";
import { HarnessError } from "../core/errors/index.ts";
import { jsonCopy } from "./task-state.ts";

function hasSubstance(value: unknown): boolean {
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some(hasSubstance);
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(([key, child]) => key.trim() !== "" && hasSubstance(child));
}

export function requireSubstantiveObjects(value: unknown, field: string): JsonObject[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(
      (entry) =>
        typeof entry !== "object" || entry === null || Array.isArray(entry) || !hasSubstance(entry),
    )
  ) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `${field} must contain nonempty substantive objects`,
    );
  }
  return jsonCopy(value as JsonObject[]);
}
