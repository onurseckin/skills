export {
  GENESIS_MERKLE_ROOT,
  computeContextHash,
  computeDomPhysicsHash,
  computeMerkleRoot,
  computeNodeStateHash,
  sha256Hex,
  verifySnapshotIntegrity,
} from "./state-hasher.ts";

export { SnapshotTree, createSnapshotTree, type SnapshotTreeOptions } from "./snapshot-tree.ts";

export { compactSnapshotTree, pruneSnapshotTree } from "./tree-pruner.ts";

export {
  captureEnvironmentContext,
  captureSessionContext,
  captureViewportContext,
  createSnapshotContext,
} from "./context-capture.ts";

export {
  assertSafeCaptureDestination,
  loadSnapshotTree,
  persistSnapshotTree,
  type SerializedSnapshotTree,
} from "./persistence.ts";

export type {
  EnvironmentContext,
  SessionContext,
  SnapshotContext,
  SnapshotMetadata,
  SnapshotNode,
  SnapshotPruneOptions,
  SnapshotPruneResult,
  SnapshotTreeStats,
  ViewportContext,
} from "./types.ts";
