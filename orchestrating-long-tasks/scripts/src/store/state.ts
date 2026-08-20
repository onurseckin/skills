import type { RunState } from "../contracts/capsule.ts";
import type { JsonObject } from "../contracts/json.ts";
import { FORMAT_VERSION, STATE_SCHEMA } from "./constants.ts";

export { sameJson } from "../core/json.ts";

export function initialState(): RunState {
  return {
    schema: STATE_SCHEMA,
    version: FORMAT_VERSION,
    revision: 0,
    event_sequence: 0,
    event_head: null,
  };
}

export function cloneObject<T extends JsonObject>(value: T): T {
  return structuredClone(value);
}
