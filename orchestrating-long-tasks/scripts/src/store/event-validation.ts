import type { IntegrityIssue } from "../contracts/capsule.ts";
import { FORMAT_VERSION, STATE_SCHEMA } from "./constants.ts";
import { issue } from "./issues.ts";

export function exactInteger(value: unknown, expected: number): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value === expected;
}

export function validateProjection(
  projection: unknown,
  sequence: number,
  revision: number,
  index: number,
): IntegrityIssue[] {
  const found: IntegrityIssue[] = [];
  if (typeof projection !== "object" || projection === null || Array.isArray(projection))
    return [issue("EVENT_PROJECTION", `event line ${index} projection must be an object`)];
  const value = projection as Record<string, unknown>;
  if ("event_head" in value)
    found.push(
      issue("EVENT_PROJECTION", `event line ${index} projection circularly includes event_head`),
    );
  if (value.schema !== STATE_SCHEMA)
    found.push(
      issue("EVENT_PROJECTION", `event line ${index} projection has an invalid state schema`),
    );
  if (!exactInteger(value.version, FORMAT_VERSION))
    found.push(
      issue("EVENT_PROJECTION", `event line ${index} projection has an invalid state version`),
    );
  if (!exactInteger(value.revision, revision))
    found.push(issue("EVENT_PROJECTION", `event line ${index} projection revision does not match`));
  if (!exactInteger(value.event_sequence, sequence))
    found.push(issue("EVENT_PROJECTION", `event line ${index} projection sequence does not match`));
  return found;
}
