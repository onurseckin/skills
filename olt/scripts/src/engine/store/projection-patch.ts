import type { ProjectionPatchOp } from "../../contracts/capsule.ts";
import type { JsonObject, JsonValue } from "../../contracts/json.ts";
import { isJsonObject } from "../../contracts/json.ts";
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

function applyOne(root: JsonObject, op: ProjectionPatchOp): void {
  let node = root;
  for (let index = 0; index < op.path.length - 1; index += 1) {
    const key = op.path[index]!;
    const child = node[key];
    if (isJsonObject(child)) {
      node = child;
    } else {
      const created: JsonObject = {};
      node[key] = created;
      node = created;
    }
  }
  const last = op.path[op.path.length - 1];
  if (last === undefined) return;
  if (op.op === "set") node[last] = op.value;
  else delete node[last];
}

export function applyProjectionPatch(
  before: JsonObject,
  ops: readonly ProjectionPatchOp[],
): JsonObject {
  const result = structuredClone(before);
  for (const op of ops) applyOne(result, op);
  return result;
}
