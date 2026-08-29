import type { JsonObject, JsonValue, ProjectionPatchOp } from "../../../core/contracts/index.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { isJsonObject } from "../../../core/contracts/index.ts";
import { sameJson } from "../../../core/json.ts";
import {
  type ArrayPatchOperation,
  applyArrayPatchOperation,
  diffArrayElements,
} from "./array-patch.ts";

function diffValue(
  path: readonly string[],
  before: JsonValue | undefined,
  after: JsonValue | undefined,
  ops: ProjectionPatchOp[],
): void {
  if (after === undefined) {
    ops.push({ op: "unset", path: [...path] });
    return;
  }
  if (before !== undefined && Array.isArray(before) && Array.isArray(after)) {
    const arrayOps: ArrayPatchOperation[] = [];
    diffArrayElements(path, before, after, arrayOps);
    for (const arrayOp of arrayOps) {
      if (arrayOp.op === "set") {
        ops.push({
          op: "set",
          path: [...arrayOp.path],
          value: arrayOp.value as JsonValue,
        });
      } else if (arrayOp.op === "unset") {
        ops.push({
          op: "unset",
          path: [...arrayOp.path],
        });
      } else if (arrayOp.op === "splice") {
        if (arrayOp.items !== undefined) {
          ops.push({
            op: "splice",
            path: [...arrayOp.path],
            start: arrayOp.start,
            deleteCount: arrayOp.deleteCount,
            items: arrayOp.items as JsonValue[],
          });
        } else {
          ops.push({
            op: "splice",
            path: [...arrayOp.path],
            start: arrayOp.start,
            deleteCount: arrayOp.deleteCount,
          });
        }
      }
    }
    return;
  }
  if (before !== undefined && isJsonObject(before) && isJsonObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) diffValue([...path, key], before[key], after[key], ops);
    return;
  }
  if (before !== undefined && sameJson(before, after)) return;
  ops.push({ op: "set", path: [...path], value: after });
}

export function diffProjection(before: JsonObject, after: JsonObject): ProjectionPatchOp[] {
  const ops: ProjectionPatchOp[] = [];
  diffValue([], before, after, ops);
  return ops;
}

function parseIndex(segment: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(segment)) {
    throw new HarnessError("INTEGRITY", `array path segment ${JSON.stringify(segment)} is invalid`);
  }
  const index = Number(segment);
  if (!Number.isSafeInteger(index)) {
    throw new HarnessError("INTEGRITY", `array path segment ${JSON.stringify(segment)} is invalid`);
  }
  return index;
}

function applyOne(root: JsonObject, op: ProjectionPatchOp): void {
  if (op.path.length === 0) {
    if (op.op === "unset") {
      throw new HarnessError("INTEGRITY", "cannot unset root projection");
    }
    return;
  }

  let node: JsonObject | JsonValue[] = root;
  for (let index = 0; index < op.path.length - 1; index += 1) {
    const key = op.path[index]!;
    if (Array.isArray(node)) {
      const arrayOffset = parseIndex(key);
      if (arrayOffset >= node.length || !(arrayOffset in node)) {
        throw new HarnessError("INTEGRITY", "array path traverses a missing index");
      }
      const child: JsonValue | undefined = node[arrayOffset];
      if (isJsonObject(child) || Array.isArray(child)) {
        node = child;
      } else {
        throw new HarnessError("INTEGRITY", "array path traverses a non-container value");
      }
    } else {
      const child: JsonValue | undefined = node[key];
      if (isJsonObject(child) || Array.isArray(child)) {
        node = child;
      } else {
        const created: JsonObject = {};
        node[key] = created;
        node = created;
      }
    }
  }

  const last = op.path[op.path.length - 1]!;

  if (op.op === "splice") {
    let targetArray: unknown;
    if (Array.isArray(node)) {
      const arrayOffset = parseIndex(last);
      if (arrayOffset >= node.length || !(arrayOffset in node)) {
        throw new HarnessError("INTEGRITY", "array path traverses a missing index");
      }
      targetArray = node[arrayOffset];
    } else {
      targetArray = node[last];
    }
    if (!Array.isArray(targetArray)) {
      throw new HarnessError("INTEGRITY", "splice target must be an array");
    }
    applyArrayPatchOperation(targetArray, op as ArrayPatchOperation);
    return;
  }

  if (Array.isArray(node)) {
    applyArrayPatchOperation(node, op as ArrayPatchOperation);
    return;
  }

  if (op.op === "set") {
    node[last] = op.value;
  } else {
    delete node[last];
  }
}

export function applyProjectionPatch(
  before: JsonObject,
  ops: readonly ProjectionPatchOp[],
): JsonObject {
  const result = structuredClone(before);
  for (const op of ops) applyOne(result, op);
  return result;
}

export function reduceEventStream(
  initialState: JsonObject,
  events: readonly {
    readonly projection?: JsonObject | null | undefined;
    readonly projection_patch?: readonly ProjectionPatchOp[] | null | undefined;
  }[],
): JsonObject {
  let state: JsonObject = structuredClone(initialState);
  for (const event of events) {
    if (event.projection !== null && event.projection !== undefined) {
      state = structuredClone(event.projection);
    } else if (event.projection_patch !== null && event.projection_patch !== undefined) {
      state = applyProjectionPatch(state, event.projection_patch);
    }
  }
  return state;
}
