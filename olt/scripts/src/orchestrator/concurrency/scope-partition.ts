/**
 * Disjoint scope partitioning utilities.
 */

export function partitionScopeDisjoint(
  scopeFiles: readonly string[],
  parallelism: number,
): readonly (readonly string[])[] {
  if (scopeFiles.length === 0 || parallelism <= 0) {
    return [];
  }

  const numPartitions = Math.min(parallelism, scopeFiles.length);
  const partitions: string[][] = Array.from({ length: numPartitions }, () => []);

  for (let i = 0; i < scopeFiles.length; i++) {
    const partition = partitions[i % numPartitions];
    const file = scopeFiles[i];
    if (partition !== undefined && file !== undefined) {
      partition.push(file);
    }
  }

  return Object.freeze(partitions.map((p) => Object.freeze(p)));
}
