import type { RunState, StateMutator } from "../../core/contracts/capsule.ts";
import type { JsonObject } from "../../core/contracts/json.ts";
import { normalizeJson } from "../../core/json.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { withRunLock } from "../../platform/run-lock.ts";
import { RESERVED_STATE_KEYS, type StoreLimits, limits } from "./constants.ts";
import { appendProjectionEvent } from "./event-append.ts";
import { loadRunProjection } from "./load.ts";
import { cloneObject, isTerminalState } from "./state.ts";

function nonblank(value: string, name: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new HarnessError("INVALID_ARGUMENT", `${name} must be a non-blank string`);
  return value;
}

export function transact(
  runRoot: string,
  actor: string,
  kind: string,
  payload: JsonObject,
  mutate: StateMutator,
  options: StoreLimits = {},
): RunState {
  nonblank(actor, "actor");
  nonblank(kind, "kind");
  if (typeof payload !== "object" || payload === null || Array.isArray(payload))
    throw new HarnessError("INVALID_ARGUMENT", "payload must be an object");
  if (typeof mutate !== "function")
    throw new HarnessError("INVALID_ARGUMENT", "mutate must be callable");
  const normalizedPayload = normalizeJson(payload, "payload") as JsonObject;
  const configured = limits(options);
  return withRunLock(runRoot, () => {
    const loaded = loadRunProjection(runRoot, options);
    const current = loaded.state;
    if (isTerminalState(current))
      throw new HarnessError("INVALID_STATE", "completed runs are terminal and cannot be mutated");
    const working = cloneObject(current);
    mutate(working);
    for (const key of RESERVED_STATE_KEYS) {
      if (working[key] !== current[key])
        throw new HarnessError(
          "INVALID_STATE",
          `mutate cannot change reserved state field: ${key}`,
        );
    }
    return appendProjectionEvent(
      loaded.runRoot,
      loaded.manifest,
      current,
      actor,
      kind,
      normalizedPayload,
      working,
      configured,
    );
  });
}
