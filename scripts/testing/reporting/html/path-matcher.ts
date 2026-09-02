import { basename } from "node:path";

const SOURCE_PREFIXES = ["scripts/", "src/", "lib/"] as const;
const TEST_PREFIXES = ["tests/", "test/", "__tests__/"] as const;
const EXT_REGEX = /(\.(test|spec))?\.(ts|tsx|js|jsx|mjs|cjs)$/i;

export function normalize(p: string): string {
  return p.replace(/\\/g, "/").trim();
}

export function getStem(p: string): string {
  return basename(p).replace(EXT_REGEX, "").toLowerCase();
}

export function stripPrefix(p: string, prefixes: readonly string[]): string {
  const norm = normalize(p);
  for (const prefix of prefixes) {
    if (norm.startsWith(prefix)) return norm.slice(prefix.length);
  }
  return norm;
}

export function matchPaths(
  target: string,
  candidates: readonly string[] | string[],
  targetPfx: readonly string[],
  candPfx: readonly string[],
): string | undefined {
  if (!target) return undefined;
  if (!candidates) return undefined;
  if (candidates.length === 0) return undefined;
  const normTarget = normalize(target);
  const targetStem = getStem(normTarget);
  const strippedTarget = stripPrefix(normTarget, targetPfx).replace(EXT_REGEX, "");

  let bestMatch: string | undefined;
  let bestScore = 0;

  for (const rawCand of candidates) {
    const normCand = normalize(rawCand);
    const candStem = getStem(normCand);
    const strippedCand = stripPrefix(normCand, candPfx).replace(EXT_REGEX, "");
    if (strippedTarget === strippedCand && strippedTarget.length > 0) return rawCand;

    let score = 0;
    if (targetStem === candStem && targetStem.length > 0) score = 3;
    else if (candStem.includes(targetStem) && targetStem.length > 2) score = 2;
    else if (targetStem.includes(candStem) && candStem.length > 2) score = 1;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = rawCand;
    }
  }

  return bestScore >= 2 ? bestMatch : undefined;
}

export function findMatchingTestFile(
  sourcePath: string,
  testFiles: readonly string[] | string[],
): string | undefined {
  return matchPaths(sourcePath, testFiles, SOURCE_PREFIXES, TEST_PREFIXES);
}

export function findMatchingSourceFile(
  testPath: string,
  sourceFiles: readonly string[] | string[],
): string | undefined {
  return matchPaths(testPath, sourceFiles, TEST_PREFIXES, SOURCE_PREFIXES);
}
