import { createHash } from "node:crypto";
import { extname } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import type { InFlightSnapshot, UncommittedFileEntry } from "./inflight-types.ts";
import type { IntentCategory, IntentDomain } from "./intent-types.ts";

export function computeSha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function extractSymbolsFromText(text: string): string[] {
  const symbols = new Set<string>();

  const fnRegex = /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g;
  let match: RegExpExecArray | null;
  while ((match = fnRegex.exec(text)) !== null) {
    if (match[1] && match[1].length > 1) symbols.add(match[1]);
  }

  const classRegex = /\b(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/g;
  while ((match = classRegex.exec(text)) !== null) {
    if (match[1] && match[1].length > 1) symbols.add(match[1]);
  }

  const interfaceRegex = /\b(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/g;
  while ((match = interfaceRegex.exec(text)) !== null) {
    if (match[1] && match[1].length > 1) symbols.add(match[1]);
  }

  const typeRegex = /\b(?:export\s+)?type\s+([A-Za-z0-9_$]+)\s*=/g;
  while ((match = typeRegex.exec(text)) !== null) {
    if (match[1] && match[1].length > 1) symbols.add(match[1]);
  }

  const enumRegex = /\b(?:export\s+)?enum\s+([A-Za-z0-9_$]+)/g;
  while ((match = enumRegex.exec(text)) !== null) {
    if (match[1] && match[1].length > 1) symbols.add(match[1]);
  }

  const constRegex = /\bexport\s+const\s+([A-Za-z0-9_$]+)/g;
  while ((match = constRegex.exec(text)) !== null) {
    if (match[1] && match[1].length > 1) symbols.add(match[1]);
  }

  const testRegex = /\b(?:describe|test|it)\s*\(\s*["'`Batch]([^"'`\n]+)["'`]/g;
  while ((match = testRegex.exec(text)) !== null) {
    if (match[1] && match[1].trim().length > 2) symbols.add(match[1].trim());
  }

  return Array.from(symbols);
}

export function classifyDomainFromFiles(
  files: readonly UncommittedFileEntry[],
  diffText: string,
): { domain: IntentDomain; score: number } {
  const scores: Record<IntentDomain, number> = {
    "UI/UX": 0,
    "Backend/API": 0,
    "Core Engine": 0,
    Testing: 0,
    Tooling: 0,
    Docs: 0,
    Architecture: 0,
  };

  for (const file of files) {
    const pathLower = file.path.toLowerCase();
    const ext = extname(pathLower);
    const weight = file.status === "added" || file.status === "untracked" ? 3 : 2;

    if (
      pathLower.includes("test") ||
      pathLower.includes("spec") ||
      pathLower.includes("__tests__") ||
      ext === ".test.ts" ||
      ext === ".spec.ts"
    ) {
      scores["Testing"] += 5 * weight;
    }

    if (
      pathLower.startsWith("docs/") ||
      pathLower.includes("/docs/") ||
      ext === ".md" ||
      ext === ".mdx" ||
      pathLower.includes("readme") ||
      pathLower.includes("changelog")
    ) {
      scores["Docs"] += 4 * weight;
    }

    if (
      pathLower.includes("ui/") ||
      pathLower.includes("view") ||
      pathLower.includes("component") ||
      pathLower.includes("frontend") ||
      pathLower.includes("theme") ||
      pathLower.includes("style") ||
      ext === ".tsx" ||
      ext === ".jsx" ||
      ext === ".css" ||
      ext === ".scss" ||
      ext === ".html"
    ) {
      scores["UI/UX"] += 4 * weight;
    }

    if (
      pathLower.includes("server") ||
      pathLower.includes("api") ||
      pathLower.includes("routes") ||
      pathLower.includes("endpoint") ||
      pathLower.includes("http") ||
      pathLower.includes("rpc") ||
      pathLower.includes("controller") ||
      pathLower.includes("handler")
    ) {
      scores["Backend/API"] += 3 * weight;
    }

    if (
      pathLower.includes("scripts/") ||
      pathLower.includes("tool") ||
      pathLower.includes("cli") ||
      pathLower.includes("bin/") ||
      pathLower.includes("package.json") ||
      pathLower.includes("tsconfig") ||
      pathLower.includes("docker")
    ) {
      scores["Tooling"] += 3 * weight;
    }

    if (
      pathLower.includes("contracts") ||
      pathLower.includes("types.ts") ||
      pathLower.includes("schema") ||
      pathLower.includes("manifest") ||
      pathLower.includes("authority") ||
      pathLower.includes("governance") ||
      pathLower.includes("pillars")
    ) {
      scores["Architecture"] += 4 * weight;
    }

    if (
      pathLower.includes("engine") ||
      pathLower.includes("core") ||
      pathLower.includes("kernel") ||
      pathLower.includes("workflow") ||
      pathLower.includes("task") ||
      pathLower.includes("orchestrator") ||
      pathLower.includes("mind") ||
      pathLower.includes("memory") ||
      pathLower.includes("state")
    ) {
      scores["Core Engine"] += 3 * weight;
    }
  }

  const diffLower = diffText.toLowerCase();
  if (
    /\b(?:react|usestate|useeffect|render|html|css|component|modal|dialog|button)\b/.test(diffLower)
  ) {
    scores["UI/UX"] += 4;
  }
  if (
    /\b(?:request|response|router|endpoint|statuscode|headers|bearer|json\(|fetch\()\b/.test(
      diffLower,
    )
  ) {
    scores["Backend/API"] += 4;
  }
  if (/\b(?:describe|expect\(|it\(|assert|testsuite|mock|fixture)\b/.test(diffLower)) {
    scores["Testing"] += 5;
  }
  if (/\b(?:spawn|child_process|argv|cli|flag|parser|compiler|bundle|esbuild)\b/.test(diffLower)) {
    scores["Tooling"] += 3;
  }
  if (/\b(?:interface\s+[A-Z]|type\s+[A-Z]|invariant|governance|authority)\b/.test(diffLower)) {
    scores["Architecture"] += 4;
  }

  let bestDomain: IntentDomain = "Core Engine";
  let maxScore = -1;

  for (const [dom, score] of Object.entries(scores) as Array<[IntentDomain, number]>) {
    if (score > maxScore) {
      maxScore = score;
      bestDomain = dom;
    }
  }

  return { domain: bestDomain, score: Math.max(1, maxScore) };
}

export function classifyCategoryFromSnapshot(
  snapshot: InFlightSnapshot,
  primaryDomain: IntentDomain,
): { category: IntentCategory; confidence: number } {
  const scores: Record<IntentCategory, number> = {
    FEATURE: 0,
    BUG_FIX: 0,
    REFACTOR: 0,
    UX_POLISH: 0,
    TESTING: 0,
    INFRASTRUCTURE: 0,
  };

  const diffLower = snapshot.rawDiff.toLowerCase();
  const stashMessages = snapshot.stashes.map((s) => s.message.toLowerCase()).join(" ");

  if (/\b(?:fix|bug|defect|issue|patch|remedy|resolve|crash|error)\b/.test(stashMessages)) {
    scores.BUG_FIX += 8;
  }
  if (/\b(?:feat|feature|add|implement|introduce|support|new)\b/.test(stashMessages)) {
    scores.FEATURE += 8;
  }
  if (/\b(?:refactor|clean|simplify|decompose|reorganize|rename|move)\b/.test(stashMessages)) {
    scores.REFACTOR += 8;
  }
  if (/\b(?:polish|style|ux|ui|theme|cosmetic|align)\b/.test(stashMessages)) {
    scores.UX_POLISH += 8;
  }
  if (/\b(?:test|spec|coverage|assert)\b/.test(stashMessages)) {
    scores.TESTING += 8;
  }
  if (/\b(?:ci|cd|docker|infra|build|workflow|deps|config)\b/.test(stashMessages)) {
    scores.INFRASTRUCTURE += 8;
  }

  if (
    /\b(?:fix(?:es|ed)?|bug|error|throw new HarnessError|catch\s*\(|fallback|null check|undefined check)\b/.test(
      diffLower,
    )
  ) {
    scores.BUG_FIX += 4;
  }
  if (
    /\b(?:export\s+function|export\s+class|export\s+interface|export\s+type|new\s+[A-Z])\b/.test(
      snapshot.rawDiff,
    )
  ) {
    scores.FEATURE += 5;
  }
  if (/\b(?:expect\(|test\(|it\(|describe\()\b/.test(diffLower)) {
    scores.TESTING += 5;
  }
  if (primaryDomain === "Testing") {
    scores.TESTING += 8;
  }
  if (
    primaryDomain === "UI/UX" &&
    snapshot.diffSummary.insertions < 40 &&
    snapshot.diffSummary.deletions < 20
  ) {
    scores.UX_POLISH += 4;
  }

  const hasAddedOrUntracked = snapshot.uncommittedFiles.some(
    (f) => f.status === "added" || f.status === "untracked",
  );
  if (hasAddedOrUntracked) {
    scores.FEATURE += 6;
  }

  const infraFileCount = snapshot.uncommittedFiles.filter(
    (f) =>
      f.path.includes("package.json") ||
      f.path.includes("tsconfig") ||
      f.path.includes("docker") ||
      f.path.includes(".github/") ||
      f.path.includes("biome.json"),
  ).length;

  if (infraFileCount > 0 && infraFileCount === snapshot.uncommittedFiles.length) {
    scores.INFRASTRUCTURE += 10;
  }

  if (
    snapshot.diffSummary.insertions > 0 &&
    snapshot.diffSummary.deletions > 0 &&
    !hasAddedOrUntracked
  ) {
    scores.REFACTOR += 3;
  }

  let bestCategory: IntentCategory = "FEATURE";
  let maxScore = -1;
  let totalScore = 0;

  for (const [cat, score] of Object.entries(scores) as Array<[IntentCategory, number]>) {
    totalScore += score;
    if (score > maxScore) {
      maxScore = score;
      bestCategory = cat;
    }
  }

  const confidence =
    totalScore > 0 ? Math.min(1, Math.max(0.6, Number((maxScore / totalScore).toFixed(2)))) : 0.75;
  return { category: bestCategory, confidence };
}
