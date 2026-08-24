export function detectCycleKahn(dependencies: ReadonlyMap<string, ReadonlySet<string>>): boolean {
  const inDegree = new Map<string, number>();
  for (const node of dependencies.keys()) {
    inDegree.set(node, 0);
  }

  for (const deps of dependencies.values()) {
    for (const dep of deps) {
      if (inDegree.has(dep)) {
        inDegree.set(dep, inDegree.get(dep)! + 1);
      }
    }
  }

  const queue: string[] = [];
  for (const [node, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(node);
    }
  }

  let count = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    count++;
    const neighbors = dependencies.get(node) || new Set<string>();
    for (const neighbor of neighbors) {
      const currentDegree = inDegree.get(neighbor) || 0;
      if (currentDegree > 0) {
        inDegree.set(neighbor, currentDegree - 1);
        if (currentDegree - 1 === 0) {
          queue.push(neighbor);
        }
      }
    }
  }

  return count !== dependencies.size;
}
