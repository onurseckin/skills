import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { calculateImpactPct, generateDeficitRoadmap } from "../deficits/index.ts";
import {
  createMetricItem,
  type DeficitCategory,
  type DeficitCluster,
  type DeficitRoadmap,
  type FileCoverageMetric,
  type FileDetailData,
  type SourceLineDetail,
  type TestRuntimeSummary,
  type UnifiedHierarchyNode,
} from "../types.ts";

const SOURCE_PREFIXES = ["scripts/", "src/", "lib/"] as const;
const TEST_PREFIXES = ["tests/", "test/", "__tests__/"] as const;
const EXT_REGEX = /(\.(test|spec))?\.(ts|tsx|js|jsx|mjs|cjs)$/i;

function normalize(p: string): string {
  return p.replace(/\\/g, "/").trim();
}

function getStem(p: string): string {
  return basename(p).replace(EXT_REGEX, "").toLowerCase();
}

function stripPrefix(p: string, prefixes: readonly string[]): string {
  const norm = normalize(p);
  for (const prefix of prefixes) {
    if (norm.startsWith(prefix)) return norm.slice(prefix.length);
  }
  return norm;
}

function matchPaths(
  target: string,
  candidates: readonly string[] | string[],
  targetPfx: readonly string[],
  candPfx: readonly string[],
): string | undefined {
  if (!target || !candidates || candidates.length === 0) return undefined;
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

function readSourceLines(
  fullPath: string,
  hitsMap: ReadonlyMap<number, number>,
): SourceLineDetail[] | undefined {
  if (!existsSync(fullPath)) return undefined;
  try {
    const rawContent = readFileSync(fullPath, "utf-8");
    return rawContent.split("\n").map((code, idx) => {
      const no = idx + 1;
      const isExecutable = hitsMap.has(no);
      return { no, code, hits: isExecutable ? hitsMap.get(no) : undefined, isExecutable };
    });
  } catch {
    return undefined;
  }
}

export function extractCoverageFileData(
  fileMap: Map<string, FileCoverageMetric>,
  repoRoot: string,
  runtime?: TestRuntimeSummary,
  deficits?: DeficitRoadmap,
): FileDetailData[] {
  const root = resolve(repoRoot);
  const filesArray: FileDetailData[] = [];
  const testFiles = runtime?.files?.map((f) => f.file) ?? [];
  const p50Set = new Set(runtime?.pareto50?.files?.map((f) => f.file) ?? []);
  const p90Set = new Set(runtime?.pareto90?.files?.map((f) => f.file) ?? []);
  const defRoadmap = deficits ?? generateDeficitRoadmap(fileMap, { rootDir: root });

  for (const [relPath, metric] of fileMap.entries()) {
    const fullPath = join(root, relPath);
    const sourceLines = readSourceLines(fullPath, metric.lineHits);

    let testFile: string | undefined;
    let testDurationMs: number | undefined;
    let testPassed: boolean | undefined;
    let testCount: number | undefined;
    let paretoClass: "p50" | "p90" | "normal" | undefined;

    if (runtime && testFiles.length > 0) {
      const match = findMatchingTestFile(relPath, testFiles);
      if (match) {
        const rec = runtime.files.find((f) => f.file === match);
        if (rec) {
          testFile = rec.file;
          testDurationMs = rec.durationMs;
          testPassed = rec.passed;
          testCount = rec.testCount;
          paretoClass = p50Set.has(rec.file) ? "p50" : p90Set.has(rec.file) ? "p90" : "normal";
        }
      }
    }

    const fileClusters = defRoadmap.clusters.filter((c) => c.file === relPath);
    const deficitCategories = Array.from(new Set(fileClusters.map((c) => c.category)));
    const maxRepoGainPct = calculateImpactPct(
      metric.uncoveredLines.length,
      defRoadmap.totalRepoLines,
    );
    const maxFileGainPct = calculateImpactPct(metric.uncoveredLines.length, metric.lines.total);

    filesArray.push({
      path: relPath,
      linesPct: metric.lines.pct,
      statementsPct: metric.statements.pct,
      funcsPct: metric.functions.pct,
      linesCovered: metric.lines.covered,
      linesTotal: metric.lines.total,
      statementsCovered: metric.statements.covered,
      statementsTotal: metric.statements.total,
      funcsCovered: metric.functions.covered,
      funcsTotal: metric.functions.total,
      uncoveredLines: metric.uncoveredLines,
      sourceLines,
      testFile,
      testDurationMs,
      testPassed,
      testCount,
      paretoClass,
      deficitClusters: fileClusters,
      deficitCategories,
      maxRepoGainPct,
      maxFileGainPct,
      deficitCount: fileClusters.length,
    });
  }

  return filesArray;
}

interface MutableDir {
  readonly name: string;
  readonly path: string;
  readonly dirs: Map<string, MutableDir>;
  readonly files: Map<string, FileDetailData>;
}

function createDir(name: string, path: string): MutableDir {
  return { name, path, dirs: new Map(), files: new Map() };
}

export function buildUnifiedHierarchy(
  files: readonly FileDetailData[] | FileDetailData[],
  _runtime?: TestRuntimeSummary,
): UnifiedHierarchyNode {
  const root = createDir("root", "");

  for (const f of files) {
    const segments = normalize(f.path).split("/").filter(Boolean);
    if (segments.length === 0) continue;

    let current = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]!;
      const curPath = current.path ? `${current.path}/${seg}` : seg;
      let next = current.dirs.get(seg);
      if (!next) {
        next = createDir(seg, curPath);
        current.dirs.set(seg, next);
      }
      current = next;
    }
    current.files.set(segments[segments.length - 1]!, f);
  }

  function resolveNode(node: MutableDir): UnifiedHierarchyNode {
    const childDirs = Array.from(node.dirs.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(resolveNode);

    const childFiles = Array.from(node.files.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, f]): UnifiedHierarchyNode => ({
        name,
        path: f.path,
        type: "file",
        lines: createMetricItem(f.linesCovered, f.linesTotal),
        statements: createMetricItem(f.statementsCovered, f.statementsTotal),
        functions: createMetricItem(f.funcsCovered, f.funcsTotal),
        uncoveredLines: f.uncoveredLines,
        testDurationMs: f.testDurationMs,
        testPassed: f.testPassed,
        testCount: f.testCount,
        testFile: f.testFile,
        paretoClass: f.paretoClass,
        deficitCount: f.deficitCount ?? f.deficitClusters?.length ?? 0,
        deficitClusters: f.deficitClusters,
        deficitCategories: f.deficitCategories,
        maxRepoGainPct: f.maxRepoGainPct,
        maxFileGainPct: f.maxFileGainPct,
      }));

    const children: UnifiedHierarchyNode[] = [...childDirs, ...childFiles];
    let lCov = 0,
      lTot = 0,
      sCov = 0,
      sTot = 0,
      fCov = 0,
      fTot = 0;
    let dur: number | undefined, count: number | undefined, passed: boolean | undefined;
    let pClass: "p50" | "p90" | "normal" | undefined;
    let defCount = 0,
      maxRepoGain = 0;
    const catSet = new Set<DeficitCategory>();

    for (const c of children) {
      lCov += c.lines.covered;
      lTot += c.lines.total;
      sCov += c.statements.covered;
      sTot += c.statements.total;
      fCov += c.functions.covered;
      fTot += c.functions.total;
      if (c.testDurationMs !== undefined) dur = (dur ?? 0) + c.testDurationMs;
      if (c.testCount !== undefined) count = (count ?? 0) + c.testCount;
      if (c.testPassed === false) passed = false;
      else if (c.testPassed === true && passed !== false) passed = true;
      if (c.paretoClass === "p50") pClass = "p50";
      else if (c.paretoClass === "p90" && pClass !== "p50") pClass = "p90";
      else if (c.paretoClass === "normal" && !pClass) pClass = "normal";
      if (c.deficitCount) defCount += c.deficitCount;
      if (c.maxRepoGainPct) maxRepoGain += c.maxRepoGainPct;
      if (c.deficitCategories) {
        for (const cat of c.deficitCategories) catSet.add(cat);
      }
    }

    const maxFileGain = calculateImpactPct(lTot - lCov, lTot);

    return {
      name: node.name,
      path: node.path,
      type: "dir",
      lines: createMetricItem(lCov, lTot),
      statements: createMetricItem(sCov, sTot),
      functions: createMetricItem(fCov, fTot),
      uncoveredLines: [],
      testDurationMs: dur,
      testPassed: passed,
      testCount: count,
      paretoClass: pClass,
      deficitCount: defCount,
      deficitCategories: Array.from(catSet),
      maxRepoGainPct: Math.round(maxRepoGain * 100) / 100,
      maxFileGainPct: maxFileGain,
      children,
    };
  }

  return resolveNode(root);
}
