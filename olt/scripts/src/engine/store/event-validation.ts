import type { IntegrityIssue } from "../../core/contracts/index.ts";
import { FORMAT_VERSION, RESERVED_STATE_KEYS, STATE_SCHEMA } from "./constants.ts";
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

const RESERVED_PATCH_ROOTS: readonly string[] = RESERVED_STATE_KEYS;

export function validateProjectionPatch(value: unknown, index: number): IntegrityIssue[] {
  if (!Array.isArray(value))
    return [
      issue("EVENT_PROJECTION_PATCH", `event line ${index} projection_patch must be an array`),
    ];
  const found: IntegrityIssue[] = [];
  value.forEach((entry, position) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      found.push(
        issue(
          "EVENT_PROJECTION_PATCH",
          `event line ${index} patch op ${position} must be an object`,
        ),
      );
      return;
    }
    const record = entry as Record<string, unknown>;
    const kind = record.op;
    if (kind !== "set" && kind !== "unset") {
      found.push(
        issue(
          "EVENT_PROJECTION_PATCH",
          `event line ${index} patch op ${position} has an invalid op`,
        ),
      );
      return;
    }
    const path = record.path;
    if (
      !Array.isArray(path) ||
      path.length === 0 ||
      !path.every((segment) => typeof segment === "string" && segment.length > 0)
    ) {
      found.push(
        issue(
          "EVENT_PROJECTION_PATCH",
          `event line ${index} patch op ${position} has an invalid path`,
        ),
      );
      return;
    }
    if (RESERVED_PATCH_ROOTS.includes(path[0] as string))
      found.push(
        issue(
          "EVENT_PROJECTION_PATCH",
          `event line ${index} patch op ${position} touches reserved field ${String(path[0])}`,
        ),
      );
    if (kind === "set" && !("value" in record))
      found.push(
        issue(
          "EVENT_PROJECTION_PATCH",
          `event line ${index} patch op ${position} is missing a value`,
        ),
      );
  });
  return found;
}

export function validateProjectionField(
  projection: unknown,
  patch: unknown,
  sequence: number,
  revision: number,
  index: number,
): IntegrityIssue[] {
  const hasProjection = projection !== null && projection !== undefined;
  const hasPatch = patch !== null && patch !== undefined;
  if (hasProjection && hasPatch)
    return [
      issue(
        "EVENT_PROJECTION",
        `event line ${index} must not carry both a checkpoint projection and a patch`,
      ),
    ];
  if (!hasProjection && !hasPatch)
    return [
      issue(
        "EVENT_PROJECTION",
        `event line ${index} must carry a checkpoint projection or a patch`,
      ),
    ];
  if (hasProjection) return validateProjection(projection, sequence, revision, index);
  return validateProjectionPatch(patch, index);
}
