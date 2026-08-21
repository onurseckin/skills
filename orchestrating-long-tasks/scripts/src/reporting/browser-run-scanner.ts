import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";

const RESULT_DIR_NAMES = ["test-results", "playwright-report", "e2e-results", "cypress/results"];

const REPORT_FILE_NAMES = new Set([
  "report.json",
  "results.json",
  "test-results.json",
  "playwright-report.json",
]);

const MAX_SCAN_DEPTH = 6;

function isReportFile(filePath: string): boolean {
  return REPORT_FILE_NAMES.has(basename(filePath).toLowerCase());
}

function scanDirectory(dirPath: string, depth = 0): string[] {
  if (depth > MAX_SCAN_DEPTH || !existsSync(dirPath)) return [];
  const found: string[] = [];
  try {
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      const name = entry.name;
      if (name.startsWith(".") || name === "node_modules" || name === ".capsules") continue;
      const fullPath = join(dirPath, name);
      if (entry.isFile()) {
        if (isReportFile(name)) found.push(fullPath);
      } else if (entry.isDirectory()) {
        found.push(...scanDirectory(fullPath, depth + 1));
      }
    }
  } catch {}
  return found;
}

function addIfReport(candidate: string, baseDir: string | undefined, into: Set<string>): void {
  const resolved = isAbsolute(candidate)
    ? candidate
    : baseDir
      ? resolve(baseDir, candidate)
      : resolve(candidate);
  try {
    if (existsSync(resolved) && statSync(resolved).isFile() && isReportFile(resolved)) {
      into.add(resolved);
    }
  } catch {}
}

export function extractBrowserReportsFromText(text: string, baseDir?: string): string[] {
  if (!text) return [];
  const pattern = /[a-zA-Z0-9_\-.\/\\~]*\.json/gi;
  const found = new Set<string>();
  for (const match of text.match(pattern) ?? []) {
    const candidate = match.trim();
    if (!candidate || !isReportFile(candidate)) continue;
    addIfReport(candidate, baseDir, found);
  }
  return Array.from(found);
}

export function findBrowserReportCandidates(
  searchDirs: readonly string[],
  stdout?: string,
  stderr?: string,
  explicitPaths?: readonly string[],
): string[] {
  const candidates = new Set<string>();

  for (const path of explicitPaths ?? []) {
    if (path) addIfReport(path, undefined, candidates);
  }

  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;
    for (const subName of RESULT_DIR_NAMES) {
      const subPath = join(dir, subName);
      if (!existsSync(subPath)) continue;
      for (const report of scanDirectory(subPath)) candidates.add(resolve(report));
    }
    try {
      if (statSync(dir).isDirectory()) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isFile() && isReportFile(entry.name)) candidates.add(resolve(dir, entry.name));
        }
      }
    } catch {}
  }

  const baseDir = searchDirs[0];
  for (const report of extractBrowserReportsFromText(stdout ?? "", baseDir)) {
    candidates.add(resolve(report));
  }
  for (const report of extractBrowserReportsFromText(stderr ?? "", baseDir)) {
    candidates.add(resolve(report));
  }

  return Array.from(candidates);
}
