import type { ImportEdge } from "./imports.ts";

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function stronglyConnectedComponents(
  edges: readonly ImportEdge[],
): readonly (readonly string[])[] {
  const nodes = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
  const adjacency = new Map<string, readonly string[]>();
  for (const node of nodes) {
    adjacency.set(
      node,
      [...new Set(edges.filter((edge) => edge.from === node).map((edge) => edge.to))].sort(compare),
    );
  }

  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const stack: string[] = [];
  const active = new Set<string>();
  const components: string[][] = [];
  let nextIndex = 0;
  const visit = (node: string): void => {
    indices.set(node, nextIndex);
    lowlinks.set(node, nextIndex++);
    stack.push(node);
    active.add(node);
    for (const target of adjacency.get(node) ?? []) {
      if (!indices.has(target)) {
        visit(target);
        lowlinks.set(node, Math.min(lowlinks.get(node)!, lowlinks.get(target)!));
      } else if (active.has(target))
        lowlinks.set(node, Math.min(lowlinks.get(node)!, indices.get(target)!));
    }
    if (lowlinks.get(node) !== indices.get(node)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      active.delete(member);
      component.push(member);
    } while (member !== node);
    if (component.length > 1 || adjacency.get(node)?.includes(node))
      components.push(component.sort(compare));
  };

  for (const node of [...nodes].sort(compare)) visit(node);
  return components.sort((left, right) => compare(left[0], right[0]));
}
