export function optimizeScopeCollisionDetection(scopeA: string[], scopeB: string[]): boolean {
  for (const a of scopeA) {
    if (scopeB.includes(a)) return true;
  }
  return false;
}
