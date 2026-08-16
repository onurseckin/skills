import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg"]);

const SCREENSHOT_DIR_NAMES = [
  "test-results",
  "screenshots",
  "__screenshots__",
  "playwright-report",
  "cypress/screenshots",
];

function isImageFile(filePath: string): boolean {
  const dotIndex = filePath.lastIndexOf(".");
  if (dotIndex === -1) return false;
  const ext = filePath.slice(dotIndex).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

function isVisualReportFile(filePath: string): boolean {
  const base = basename(filePath).toLowerCase();
  return (
    base === "visual-report.json" ||
    base.endsWith("-visual-report.json") ||
    base === "visual_report.json"
  );
}

export function scanDirectoryForImages(dirPath: string, maxDepth = 8, currentDepth = 0): string[] {
  if (!existsSync(dirPath) || currentDepth > maxDepth) return [];
  const found: string[] = [];

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryName = entry.name;
      if (
        entryName.startsWith(".") ||
        entryName === "node_modules" ||
        entryName === ".git" ||
        entryName === ".capsules"
      ) {
        continue;
      }

      const fullPath = join(dirPath, entryName);
      if (entry.isFile() && isImageFile(entryName)) {
        found.push(fullPath);
      } else if (entry.isDirectory()) {
        found.push(...scanDirectoryForImages(fullPath, maxDepth, currentDepth + 1));
      }
    }
  } catch {}

  return found;
}

export function scanDirectoryForVisualReports(
  dirPath: string,
  maxDepth = 8,
  currentDepth = 0,
): string[] {
  if (!existsSync(dirPath) || currentDepth > maxDepth) return [];
  const found: string[] = [];

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryName = entry.name;
      if (
        entryName.startsWith(".") ||
        entryName === "node_modules" ||
        entryName === ".git" ||
        entryName === ".capsules"
      ) {
        continue;
      }

      const fullPath = join(dirPath, entryName);
      if (entry.isFile() && isVisualReportFile(entryName)) {
        found.push(fullPath);
      } else if (entry.isDirectory()) {
        found.push(...scanDirectoryForVisualReports(fullPath, maxDepth, currentDepth + 1));
      }
    }
  } catch {}

  return found;
}

export function extractImagesFromText(text: string, baseDir?: string): string[] {
  if (!text) return [];
  const pattern = /(?:[a-zA-Z0-9_\-\.\/\\~]+\.(?:png|jpg|jpeg|webp|gif|bmp|svg))/gi;
  const matches = text.match(pattern) ?? [];
  const validPaths: string[] = [];

  for (const match of matches) {
    const candidate = match.trim();
    if (!candidate) continue;
    const resolved = isAbsolute(candidate)
      ? candidate
      : baseDir
        ? resolve(baseDir, candidate)
        : resolve(candidate);

    if (existsSync(resolved)) {
      try {
        if (statSync(resolved).isFile()) {
          validPaths.push(resolved);
        }
      } catch {}
    }
  }

  return validPaths;
}

export function extractVisualReportsFromText(text: string, baseDir?: string): string[] {
  if (!text) return [];
  const pattern =
    /(?:[a-zA-Z0-9_\-\.\/\\~]*(?:visual-report|visual_report)[a-zA-Z0-9_\-\.]*\.json)/gi;
  const matches = text.match(pattern) ?? [];
  const validPaths: string[] = [];

  for (const match of matches) {
    const candidate = match.trim();
    if (!candidate) continue;
    const resolved = isAbsolute(candidate)
      ? candidate
      : baseDir
        ? resolve(baseDir, candidate)
        : resolve(candidate);

    if (existsSync(resolved)) {
      try {
        if (statSync(resolved).isFile()) {
          validPaths.push(resolved);
        }
      } catch {}
    }
  }

  return validPaths;
}

export function discoverScreenshotCandidates(
  searchDirs: string[],
  stdout?: string,
  stderr?: string,
  explicitPaths?: string[],
): string[] {
  const candidates = new Set<string>();

  if (explicitPaths) {
    for (const p of explicitPaths) {
      if (!p) continue;
      const resolved = resolve(p);
      if (existsSync(resolved)) {
        try {
          if (statSync(resolved).isFile() && isImageFile(resolved)) {
            candidates.add(resolved);
          }
        } catch {}
      }
    }
  }

  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;

    for (const subName of SCREENSHOT_DIR_NAMES) {
      const subPath = join(dir, subName);
      if (existsSync(subPath)) {
        for (const img of scanDirectoryForImages(subPath)) {
          candidates.add(resolve(img));
        }
      }
    }

    try {
      const stat = statSync(dir);
      if (stat.isDirectory()) {
        const topEntries = readdirSync(dir, { withFileTypes: true });
        for (const ent of topEntries) {
          if (ent.isFile() && isImageFile(ent.name)) {
            candidates.add(resolve(dir, ent.name));
          }
        }
      }
    } catch {}
  }

  const baseDir = searchDirs[0];
  if (stdout) {
    for (const img of extractImagesFromText(stdout, baseDir)) {
      candidates.add(resolve(img));
    }
  }
  if (stderr) {
    for (const img of extractImagesFromText(stderr, baseDir)) {
      candidates.add(resolve(img));
    }
  }

  return Array.from(candidates);
}

export function findVisualReportCandidates(
  searchDirs: string[],
  stdout?: string,
  stderr?: string,
  explicitPaths?: string[],
): string[] {
  const candidates = new Set<string>();

  if (explicitPaths) {
    for (const p of explicitPaths) {
      if (!p) continue;
      const resolved = resolve(p);
      if (existsSync(resolved)) {
        try {
          if (statSync(resolved).isFile() && isVisualReportFile(resolved)) {
            candidates.add(resolved);
          }
        } catch {}
      }
    }
  }

  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;

    for (const subName of SCREENSHOT_DIR_NAMES) {
      const subPath = join(dir, subName);
      if (existsSync(subPath)) {
        for (const rep of scanDirectoryForVisualReports(subPath)) {
          candidates.add(resolve(rep));
        }
      }
    }

    try {
      const stat = statSync(dir);
      if (stat.isDirectory()) {
        const topEntries = readdirSync(dir, { withFileTypes: true });
        for (const ent of topEntries) {
          if (ent.isFile() && isVisualReportFile(ent.name)) {
            candidates.add(resolve(dir, ent.name));
          }
        }
      }
    } catch {}
  }

  const baseDir = searchDirs[0];
  if (stdout) {
    for (const rep of extractVisualReportsFromText(stdout, baseDir)) {
      candidates.add(resolve(rep));
    }
  }
  if (stderr) {
    for (const rep of extractVisualReportsFromText(stderr, baseDir)) {
      candidates.add(resolve(rep));
    }
  }

  return Array.from(candidates);
}
