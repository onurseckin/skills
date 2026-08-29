import { HarnessError } from "../../../core/errors/index.ts";
import { sameJson } from "../../../core/json.ts";

export type ArrayPatchOperation =
  | { readonly op: "set"; readonly path: readonly string[]; readonly value: unknown }
  | { readonly op: "unset"; readonly path: readonly string[] }
  | {
      readonly op: "splice";
      readonly path: readonly string[];
      readonly start: number;
      readonly deleteCount: number;
      readonly items?: readonly unknown[] | undefined;
    };

function areElementsEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  try {
    return sameJson(left, right);
  } catch {
    return false;
  }
}

export function isMonotonicArrayAppend(
  before: readonly unknown[],
  after: readonly unknown[],
): boolean {
  if (!Array.isArray(before) || !Array.isArray(after)) return false;
  if (before.length > after.length) return false;
  for (let index = 0; index < before.length; index += 1) {
    if (!(index in before) || !(index in after) || !areElementsEqual(before[index], after[index])) {
      return false;
    }
  }
  return true;
}

export function diffArrayElements(
  path: readonly string[],
  before: readonly unknown[],
  after: readonly unknown[],
  ops: ArrayPatchOperation[],
): void {
  if (before.length <= after.length && isMonotonicArrayAppend(before, after)) {
    for (let index = before.length; index < after.length; index += 1) {
      ops.push({ op: "set", path: [...path, String(index)], value: after[index] });
    }
    return;
  }

  if (after.length < before.length && isMonotonicArrayAppend(after, before)) {
    ops.push({
      op: "splice",
      path: [...path],
      start: after.length,
      deleteCount: before.length - after.length,
    });
    return;
  }

  if (before.length === after.length) {
    for (let index = 0; index < before.length; index += 1) {
      if (!areElementsEqual(before[index], after[index])) {
        ops.push({ op: "set", path: [...path, String(index)], value: after[index] });
      }
    }
    return;
  }

  let prefixLen = 0;
  while (
    prefixLen < before.length &&
    prefixLen < after.length &&
    areElementsEqual(before[prefixLen], after[prefixLen])
  ) {
    prefixLen += 1;
  }

  let suffixLen = 0;
  while (
    suffixLen < before.length - prefixLen &&
    suffixLen < after.length - prefixLen &&
    areElementsEqual(before[before.length - 1 - suffixLen], after[after.length - 1 - suffixLen])
  ) {
    suffixLen += 1;
  }

  const deleteCount = before.length - prefixLen - suffixLen;
  const newItems = after.slice(prefixLen, after.length - suffixLen);
  if (newItems.length > 0) {
    ops.push({
      op: "splice",
      path: [...path],
      start: prefixLen,
      deleteCount,
      items: newItems,
    });
  } else {
    ops.push({
      op: "splice",
      path: [...path],
      start: prefixLen,
      deleteCount,
    });
  }
}

function parseArrayIndex(segment: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(segment)) {
    throw new HarnessError("INTEGRITY", `array path segment ${JSON.stringify(segment)} is invalid`);
  }
  const index = Number(segment);
  if (!Number.isSafeInteger(index)) {
    throw new HarnessError("INTEGRITY", `array path segment ${JSON.stringify(segment)} is invalid`);
  }
  return index;
}

export function applyArrayPatchOperation(targetArray: unknown[], op: ArrayPatchOperation): void {
  if (!Array.isArray(targetArray)) {
    throw new HarnessError("INTEGRITY", "targetArray must be a valid array");
  }

  if (op.op === "set") {
    if (op.path.length === 0) {
      throw new HarnessError("INTEGRITY", "array set operation requires an index path segment");
    }
    const index = parseArrayIndex(op.path[op.path.length - 1]!);
    if (index > targetArray.length || (index < targetArray.length && !(index in targetArray))) {
      throw new HarnessError(
        "INTEGRITY",
        `array index ${index} creates or traverses a sparse array`,
      );
    }
    targetArray[index] = op.value;
    return;
  }

  if (op.op === "unset") {
    throw new HarnessError("INTEGRITY", "array path cannot unset an index; use splice instead");
  }

  if (op.op === "splice") {
    if (typeof op.start !== "number" || !Number.isSafeInteger(op.start)) {
      throw new HarnessError("INTEGRITY", "splice start must be a safe integer");
    }
    if (op.start < 0 || op.start > targetArray.length) {
      throw new HarnessError(
        "INTEGRITY",
        `splice start ${op.start} is out of bounds for array of length ${targetArray.length}`,
      );
    }
    if (typeof op.deleteCount !== "number" || !Number.isSafeInteger(op.deleteCount)) {
      throw new HarnessError("INTEGRITY", "splice deleteCount must be a safe integer");
    }
    if (op.deleteCount < 0) {
      throw new HarnessError(
        "INTEGRITY",
        `splice deleteCount ${op.deleteCount} must be non-negative`,
      );
    }
    if (op.start + op.deleteCount > targetArray.length) {
      throw new HarnessError(
        "INTEGRITY",
        `splice deleteCount ${op.deleteCount} at start ${op.start} exceeds array length ${targetArray.length}`,
      );
    }
    if (op.items !== undefined && !Array.isArray(op.items)) {
      throw new HarnessError("INTEGRITY", "splice items must be an array when provided");
    }

    if (op.items !== undefined && op.items.length > 0) {
      targetArray.splice(op.start, op.deleteCount, ...op.items);
    } else {
      targetArray.splice(op.start, op.deleteCount);
    }
    return;
  }

  throw new HarnessError("INTEGRITY", "unsupported array patch operation");
}
