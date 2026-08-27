import type { RunState, StateMutator } from "../../core/contracts/capsule.ts";
import type { JsonObject } from "../../core/contracts/json.ts";
import { normalizeJson } from "../../core/json.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { withRunLock } from "../../platform/run-lock.ts";
import { RESERVED_STATE_KEYS, type StoreLimits, limits } from "./constants.ts";
import { appendProjectionEvent } from "./event-append.ts";
import { loadRunProjection } from "./load.ts";
import { cloneObject, isTerminalState } from "./state.ts";
import { materializeProjections } from "./materialized-projections.ts";
import { readTransactionMarker } from "./event-append.ts";
import { recoverProjectionLocked } from "./recovery.ts";

function nonblank(value: string, name: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new HarnessError("INVALID_ARGUMENT", `${name} must be a non-blank string`);
  return value;
}

export interface IdempotentTransactionResult {
  readonly state: RunState;
  readonly already_committed: boolean;
}

export interface IdempotentTransactionIdentity {
  readonly requestKey: string;
  readonly contentDigest: string;
  readonly semanticVersion: number;
  readonly authorityActor: string;
  readonly destinations: readonly string[];
}

function currentBrainstorming(state: RunState): JsonObject | undefined {
  const planning = state.planning;
  if (typeof planning !== "object" || planning === null || Array.isArray(planning))
    return undefined;
  const brainstorming = (planning as JsonObject)["brainstorming"];
  if (typeof brainstorming !== "object" || brainstorming === null || Array.isArray(brainstorming)) {
    return undefined;
  }
  return brainstorming as JsonObject;
}

function assertIdentity(identity: IdempotentTransactionIdentity): void {
  nonblank(identity.requestKey, "requestKey");
  if (!/^[0-9a-f]{64}$/u.test(identity.contentDigest))
    throw new HarnessError("INVALID_ARGUMENT", "contentDigest must be a sha256 digest");
  if (!Number.isSafeInteger(identity.semanticVersion) || identity.semanticVersion < 1)
    throw new HarnessError("INVALID_ARGUMENT", "semanticVersion must be a positive integer");
  nonblank(identity.authorityActor, "authorityActor");
  if (
    identity.destinations.length === 0 ||
    identity.destinations.some((path) => !path || path.includes("/") || path.includes("\\"))
  )
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "destinations must be canonical bare artifact names",
    );
}

function hasSameIdentity(current: JsonObject, identity: IdempotentTransactionIdentity): boolean {
  const destinations = current["projection_destinations"];
  return (
    current["request_key"] === identity.requestKey &&
    current["content_digest"] === identity.contentDigest &&
    current["version"] === identity.semanticVersion &&
    current["authority_actor"] === identity.authorityActor &&
    Array.isArray(destinations) &&
    destinations.length === identity.destinations.length &&
    destinations.every((value, index) => value === identity.destinations[index])
  );
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

export function transactIdempotent(
  runRoot: string,
  actor: string,
  kind: string,
  identity: IdempotentTransactionIdentity,
  payload: JsonObject,
  mutate: StateMutator,
  options: StoreLimits = {},
): IdempotentTransactionResult {
  assertIdentity(identity);
  const configured = limits(options);
  return withRunLock(runRoot, () => {
    if (readTransactionMarker(runRoot) !== undefined) recoverProjectionLocked(runRoot, actor);
    const loaded = loadRunProjection(runRoot, options);
    const current = loaded.state;
    const brainstorming = currentBrainstorming(current);
    if (brainstorming?.["request_key"] === identity.requestKey) {
      if (!hasSameIdentity(brainstorming, identity))
        throw new HarnessError(
          "INTEGRITY",
          "request_key collision does not match authoritative identity",
        );
      materializeProjections(loaded.runRoot, current);
      return { state: cloneObject(current), already_committed: true };
    }
    if (isTerminalState(current))
      throw new HarnessError("INVALID_STATE", "completed runs are terminal and cannot be mutated");
    const working = cloneObject(current);
    mutate(working);
    for (const key of RESERVED_STATE_KEYS) {
      if (working[key] !== current[key]) {
        throw new HarnessError(
          "INVALID_STATE",
          `mutate cannot change reserved state field: ${key}`,
        );
      }
    }
    const normalizedPayload = normalizeJson(payload, "payload") as JsonObject;
    return {
      state: appendProjectionEvent(
        loaded.runRoot,
        loaded.manifest,
        current,
        actor,
        kind,
        normalizedPayload,
        working,
        configured,
      ),
      already_committed: false,
    };
  });
}
