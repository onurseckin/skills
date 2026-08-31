import type { DomPhysicsSnapshot } from "../runners/types.ts";

export interface EnvironmentContext {
  readonly timestamp: string;
  readonly platform: string;
  readonly runtime: string;
  readonly runtimeVersion: string;
  readonly heapUsedBytes: number;
  readonly heapTotalBytes: number;
  readonly processUptimeSeconds: number;
  readonly environmentSha256: string;
}

export interface ViewportContext {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor: number;
  readonly isLandscape: boolean;
  readonly hasTouch: boolean;
}

export interface SessionContext {
  readonly authenticated: boolean;
  readonly role?: string | undefined;
  readonly personaId?: string | undefined;
  readonly sessionHash?: string | undefined;
}

export interface SnapshotContext {
  readonly environment: EnvironmentContext;
  readonly viewport: ViewportContext;
  readonly session: SessionContext;
  readonly url?: string | undefined;
  readonly screenId?: string | undefined;
}

export interface SnapshotMetadata {
  readonly nodeId: string;
  readonly parentId?: string | undefined;
  readonly label: string;
  readonly sequence: number;
  readonly createdAt: string;
  readonly depth: number;
  readonly stateHash: string;
  readonly merkleRoot: string;
}

export interface SnapshotNode {
  readonly id: string;
  readonly parentId?: string | undefined;
  readonly label: string;
  readonly sequence: number;
  readonly createdAt: string;
  readonly depth: number;
  readonly context: SnapshotContext;
  readonly physics: DomPhysicsSnapshot;
  readonly stateHash: string;
  readonly merkleRoot: string;
  readonly children: readonly string[];
}

export interface SnapshotTreeStats {
  readonly totalNodes: number;
  readonly maxDepth: number;
  readonly rootId: string;
  readonly treeMerkleRoot: string;
  readonly memorySizeBytesEstimated: number;
  readonly isDisposed: boolean;
}

export interface SnapshotPruneOptions {
  readonly maxNodes?: number | undefined;
  readonly maxDepth?: number | undefined;
  readonly maxAgeMs?: number | undefined;
  readonly preserveRoot?: boolean | undefined;
}

export interface SnapshotPruneResult {
  readonly prunedNodeIds: readonly string[];
  readonly retainedNodeCount: number;
  readonly bytesReleasedEstimated: number;
}
