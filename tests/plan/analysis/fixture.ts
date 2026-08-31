export function createSampleScopePair(): { scopeA: string[]; scopeB: string[]; disjointScope: string[] } {
  return {
    scopeA: ["src/plan/engine.ts", "tests/plan/engine.test.ts"],
    scopeB: ["src/plan/engine.ts", "tests/plan/other.test.ts"],
    disjointScope: ["src/auth/login.ts", "tests/auth/login.test.ts"],
  };
}
