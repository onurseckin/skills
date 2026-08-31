import type { ImportEdge } from "./imports.ts";

function compare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function stronglyConnectedComponents(
  edges: readonly ImportEdge[],
): readonly (readonly string[])[] {
  const adjMap = new Map<string, Set<string>>();
  const nodes = new Set<string>();
  for (const edge of edges) {
    nodes.add(edge.from);
    nodes.add(edge.to);
    let targets = adjMap.get(edge.from);
    if (targets === undefined) {
      targets = new Set<string>();
      adjMap.set(edge.from, targets);
    }
    targets.add(edge.to);
  }

  const adjacency = new Map<string, readonly string[]>();
  for (const node of nodes) {
    const targets = adjMap.get(node);
    adjacency.set(node, targets !== undefined ? [...targets].sort(compare) : []);
  }

  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const stack: string[] = [];
  const active = new Set<string>();
  const components: string[][] = [];
  let nextIndex = 0;

  const visit = (node: string): void => {
    indices.set(node, nextIndex);
    lowlinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    active.add(node);

    const targets = adjacency.get(node);
    const targetList = targets !== undefined ? targets : [];
    for (const target of targetList) {
      const targetIndex = indices.get(target);
      if (targetIndex === undefined) {
        visit(target);
        const nodeLow = lowlinks.get(node);
        const targetLow = lowlinks.get(target);
        if (nodeLow !== undefined && targetLow !== undefined) {
          lowlinks.set(node, Math.min(nodeLow, targetLow));
        }
      } else if (active.has(target)) {
        const nodeLow = lowlinks.get(node);
        if (nodeLow !== undefined) {
          lowlinks.set(node, Math.min(nodeLow, targetIndex));
        }
      }
    }

    if (lowlinks.get(node) !== indices.get(node)) return;

    const component: string[] = [];
    let member: string | undefined;
    while (stack.length > 0) {
      member = stack.pop();
      if (member === undefined) break;
      active.delete(member);
      component.push(member);
      if (member === node) break;
    }

    const nodeTargets = adjacency.get(node);
    const selfEdge = nodeTargets !== undefined && nodeTargets.includes(node);
    if (component.length > 1) {
      components.push(component.sort(compare));
    } else if (selfEdge) {
      components.push(component.sort(compare));
    }
  };

  for (const node of [...nodes].sort(compare)) {
    if (!indices.has(node)) {
      visit(node);
    }
  }

  return components.sort((left, right) => {
    const leftFirst = left[0] !== undefined ? left[0] : "";
    const rightFirst = right[0] !== undefined ? right[0] : "";
    return compare(leftFirst, rightFirst);
  });
}
