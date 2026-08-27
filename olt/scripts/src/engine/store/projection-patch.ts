import type { ProjectionPatchOp } from "../../core/contracts/capsule.ts";
import type { JsonObject, JsonValue } from "../../core/contracts/json.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { isJsonObject } from "../../core/contracts/json.ts";
import { sameJson } from "../../core/json.ts";

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
    let matchingPrefix = before.length < after.length;
    const appended: ProjectionPatchOp[] = [];
    for (let index = 0; matchingPrefix && index < before.length; index += 1) {
      if (!(index in before) || !(index in after) || !sameJson(before[index], after[index]))
        matchingPrefix = false;
    }
    if (matchingPrefix) {
      for (let index = before.length; index < after.length; index += 1) {
        if (!(index in after)) {
          matchingPrefix = false;
          break;
        }
        appended.push({ op: "set", path: [...path, String(index)], value: after[index]! });
      }
      if (matchingPrefix) {
        ops.push(...appended);
        return;
      }
    }
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

function arrayIndex(segment: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(segment))
    throw new HarnessError("INTEGRITY", `array path segment ${JSON.stringify(segment)} is invalid`);
  const index = Number(segment);
  if (!Number.isSafeInteger(index))
    throw new HarnessError("INTEGRITY", `array path segment ${JSON.stringify(segment)} is invalid`);
  return index;
}

function applyOne(root: JsonObject, op: ProjectionPatchOp): void {
  let node: JsonObject | JsonValue[] = root;
  for (let index = 0; index < op.path.length - 1; index += 1) {
    const key = op.path[index]!;
    if (Array.isArray(node)) {
      const arrayOffset = arrayIndex(key);
      if (arrayOffset >= node.length || !(arrayOffset in node))
        throw new HarnessError("INTEGRITY", "array path traverses a missing index");
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
  const last = op.path[op.path.length - 1];
  if (last === undefined) return;
  if (Array.isArray(node)) {
    const arrayOffset = arrayIndex(last);
    if (op.op === "unset") throw new HarnessError("INTEGRITY", "array path cannot unset an index");
    if (arrayOffset > node.length || (arrayOffset < node.length && !(arrayOffset in node)))
      throw new HarnessError("INTEGRITY", "array path creates a sparse array");
    node[arrayOffset] = op.value;
  } else if (op.op === "set") {
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
