/**
 * Scope normalization and overlap checking helpers for topology synthesis.
 */

export function normalizeScope(path: string): string {
  let normalized = path.trim().replace(/\\/g, "/");
  if (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  while (normalized.endsWith("/") && normalized.length > 1) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function doScopesOverlap(scopeA: string, scopeB: string): boolean {
  const normA = normalizeScope(scopeA);
  const normB = normalizeScope(scopeB);

  if (normA === normB) {
    return true;
  }

  const slashA = normA.endsWith("/") ? normA : `${normA}/`;
  const slashB = normB.endsWith("/") ? normB : `${normB}/`;

  return normB.startsWith(slashA) || normA.startsWith(slashB);
}

export function checkScopeListOverlap(
  scopesA: readonly string[],
  scopesB: readonly string[],
): {
  readonly overlap: boolean;
  readonly pathA?: string | undefined;
  readonly pathB?: string | undefined;
} {
  for (const a of scopesA) {
    for (const b of scopesB) {
      if (doScopesOverlap(a, b)) {
        return { overlap: true, pathA: a, pathB: b };
      }
    }
  }
  return { overlap: false };
}
