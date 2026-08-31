import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, normalize, resolve } from "node:path";
import { atomicWriteBytes } from "../../core/durable-write.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { SnapshotTree } from "./snapshot-tree.ts";
import { verifySnapshotIntegrity } from "./state-hasher.ts";
import type { SnapshotNode, SnapshotTreeStats } from "./types.ts";

export interface SerializedSnapshotTree {
  readonly schema: "snapshot.tree.v1";
  readonly version: 1;
  readonly stats: SnapshotTreeStats;
  readonly nodes: readonly SnapshotNode[];
  readonly persistedAt: string;
}

export function assertSafeCaptureDestination(targetPath: string): void {
  const normalized = normalize(resolve(targetPath));
  const cwd = normalize(process.cwd());
  const sysTmp = normalize(tmpdir());

  // Allowed roots: .tmp/ inside repo, .olt/capsules/ inside repo, system tmpdir
  const dotTmp = normalize(resolve(cwd, ".tmp"));
  const oltCapsules = normalize(resolve(cwd, ".olt/capsules"));
  const oltScratch = normalize(resolve(cwd, ".olt/scratch"));

  const isUnderDotTmp = normalized.startsWith(dotTmp);
  const isUnderOltCapsules = normalized.startsWith(oltCapsules);
  const isUnderOltScratch = normalized.startsWith(oltScratch);
  const isUnderSysTmp = normalized.startsWith(sysTmp);

  if (!isUnderDotTmp && !isUnderOltCapsules && !isUnderOltScratch && !isUnderSysTmp) {
    throw new HarnessError(
      "PATH_SAFETY",
      `Capture and snapshot persistence violation: destination '${targetPath}' is outside safe confinement roots (.tmp/, .olt/capsules/, .olt/scratch/, tmpdir)`,
    );
  }
}

export function persistSnapshotTree(
  tree: SnapshotTree,
  destinationPath: string,
): { readonly filePath: string; readonly bytesWritten: number; readonly merkleRoot: string } {
  assertSafeCaptureDestination(destinationPath);
  const targetDir = dirname(destinationPath);
  mkdirSync(targetDir, { recursive: true });

  const stats = tree.getStats();
  const nodes = tree.getAllNodes();

  const payload: SerializedSnapshotTree = {
    schema: "snapshot.tree.v1",
    version: 1,
    stats,
    nodes,
    persistedAt: new Date().toISOString(),
  };

  const buffer = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  atomicWriteBytes(destinationPath, buffer);

  return {
    filePath: destinationPath,
    bytesWritten: buffer.byteLength,
    merkleRoot: stats.treeMerkleRoot,
  };
}

export function loadSnapshotTree(filePath: string): SnapshotTree {
  if (!existsSync(filePath)) {
    throw new HarnessError("NOT_FOUND", `Snapshot tree file not found: '${filePath}'`);
  }

  const raw = readFileSync(filePath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HarnessError("INTEGRITY", `Invalid JSON in snapshot tree file: '${filePath}'`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new HarnessError("INTEGRITY", `Invalid snapshot tree schema in file: '${filePath}'`);
  }

  const doc = parsed as Partial<SerializedSnapshotTree>;
  if (doc.schema !== "snapshot.tree.v1" || !Array.isArray(doc.nodes)) {
    throw new HarnessError("INTEGRITY", `Unsupported snapshot tree schema: '${doc.schema}'`);
  }

  const tree = new SnapshotTree();
  const rootNode = doc.nodes.find((n) => !n.parentId || n.depth === 0);
  if (!rootNode) {
    return tree;
  }

  if (!verifySnapshotIntegrity(rootNode)) {
    throw new HarnessError(
      "INTEGRITY",
      `Corrupted state hash detected for root node '${rootNode.id}'`,
    );
  }

  tree.addRoot({
    id: rootNode.id,
    label: rootNode.label,
    context: rootNode.context,
    physics: rootNode.physics,
  });

  const remainingNodes = doc.nodes
    .filter((n) => n.id !== rootNode.id)
    .sort((a, b) => a.depth - b.depth);

  for (const node of remainingNodes) {
    if (!verifySnapshotIntegrity(node)) {
      throw new HarnessError(
        "INTEGRITY",
        `Corrupted state hash detected for node '${node.id}' in tree`,
      );
    }
    if (node.parentId) {
      tree.addChild({
        id: node.id,
        parentId: node.parentId,
        label: node.label,
        context: node.context,
        physics: node.physics,
      });
    }
  }

  return tree;
}
