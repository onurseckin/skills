import { createHash } from "node:crypto";
import type { DomPhysicsSnapshot } from "../runners/types.ts";
import type { SnapshotContext, SnapshotNode } from "./types.ts";

export const GENESIS_MERKLE_ROOT = "0".repeat(64);

export function sha256Hex(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const entries = keys
      .filter((k) => record[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalStringify(record[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(String(value));
}

export function computeDomPhysicsHash(physics: DomPhysicsSnapshot): string {
  const normalized = {
    viewport: physics.viewport,
    scrollPosition: physics.scrollPosition,
    capturedAt: physics.capturedAt,
    elementCount: physics.elements.length,
    elements: physics.elements.map((el) => ({
      selector: el.selector,
      tagName: el.tagName,
      id: el.id ?? null,
      role: el.role ?? null,
      ariaLabel: el.ariaLabel ?? null,
      bounds: el.bounds,
      computedStyles: el.computedStyles,
      metrics: el.metrics,
      textSnippet: el.textSnippet ?? null,
    })),
    layoutOverflows: physics.layoutOverflows,
    textClippings: physics.textClippings,
  };
  return sha256Hex(canonicalStringify(normalized));
}

export function computeContextHash(context: SnapshotContext): string {
  return sha256Hex(canonicalStringify(context));
}

export function computeNodeStateHash(params: {
  readonly context: SnapshotContext;
  readonly physics: DomPhysicsSnapshot;
  readonly label: string;
  readonly sequence: number;
}): string {
  const contextHash = computeContextHash(params.context);
  const physicsHash = computeDomPhysicsHash(params.physics);
  const composite = `${params.sequence}:${params.label}:${contextHash}:${physicsHash}`;
  return sha256Hex(composite);
}

export function computeMerkleRoot(childHashes: readonly string[]): string {
  if (childHashes.length === 0) {
    return GENESIS_MERKLE_ROOT;
  }
  if (childHashes.length === 1) {
    return sha256Hex(`LEAF:${childHashes[0]}`);
  }
  let currentLevel = [...childHashes].sort();
  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
      nextLevel.push(sha256Hex(`NODE:${left}:${right}`));
    }
    currentLevel = nextLevel;
  }
  return currentLevel[0] ?? GENESIS_MERKLE_ROOT;
}

export function verifySnapshotIntegrity(node: SnapshotNode): boolean {
  const expectedStateHash = computeNodeStateHash({
    context: node.context,
    physics: node.physics,
    label: node.label,
    sequence: node.sequence,
  });
  return expectedStateHash === node.stateHash;
}
