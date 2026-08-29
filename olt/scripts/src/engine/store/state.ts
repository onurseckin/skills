import type { RunState } from "../../core/contracts/index.ts";
import type { JsonObject } from "../../core/contracts/index.ts";
import { FORMAT_VERSION, RESERVED_STATE_KEYS, STATE_SCHEMA } from "./constants.ts";

export { sameJson } from "../../core/json.ts";

import type { CapsuleMode } from "../../core/contracts/index.ts";

export function initialState(mode?: CapsuleMode): RunState {
  return {
    schema: STATE_SCHEMA,
    version: FORMAT_VERSION,
    revision: 0,
    event_sequence: 0,
    event_head: null,
    ...(mode === "mind" ? { mind: { generation: 1, candidates: [] } } : {}),
  };
}

export function cloneObject<T extends JsonObject>(value: T): T {
  return structuredClone(value);
}

export function businessFields(state: JsonObject): JsonObject {
  const reserved: readonly string[] = RESERVED_STATE_KEYS;
  const result: JsonObject = {};
  for (const key of Object.keys(state)) {
    if (reserved.includes(key)) continue;
    result[key] = state[key]!;
  }
  return result;
}

export function isTerminalState(state: RunState): boolean {
  const result = state.completion_result;
  return (
    typeof result === "object" &&
    result !== null &&
    !Array.isArray(result) &&
    result.status === "complete"
  );
}
