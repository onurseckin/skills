export const MANDATORY_COVERAGE_THRESHOLD = 90;

export interface TestStreamEvent {
  readonly id: string;
  readonly testName: string;
  readonly suiteName: string;
  readonly durationMs: number;
  readonly status: "pass" | "fail" | "skip";
  readonly errorSnippet?: string | undefined;
}

export interface StreamProcessingResult {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly totalDurationMs: number;
  readonly passRate: number;
  readonly minDurationMs?: number | undefined;
  readonly maxDurationMs?: number | undefined;
  readonly avgDurationMs?: number | undefined;
}

export interface CoverageBreakdown {
  readonly linesPercentage: number;
  readonly statementsPercentage: number;
  readonly functionsPercentage: number;
  readonly branchesPercentage: number;
}

export interface CoverageGateVerdict {
  readonly meetsGate: boolean;
  readonly threshold: number;
  readonly averageCoverage: number;
  readonly breakdown: CoverageBreakdown;
  readonly deficit: number;
}

export interface ParetoSkewResult {
  readonly p50Count: number;
  readonly p90Count: number;
  readonly totalDurationMs: number;
  readonly isSkewed: boolean;
}

export interface ObsidianDashboardOptions {
  readonly title?: string | undefined;
  readonly deepLinkPrefix?: string | undefined;
  readonly activeDeepLink?: string | undefined;
  readonly themeTokens?: Record<string, string> | undefined;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatDeepLink(filePath: string, lineNumber?: number): string {
  const norm = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return lineNumber ? `#coverage/${norm}:L${lineNumber}` : `#coverage/${norm}`;
}

export function sanitizeVirtualPath(inputPath: string, root = "/"): string {
  const norm = inputPath.replace(/\\/g, "/");
  const combined = norm.startsWith("/") ? norm : `${root}/${norm}`;
  const segments: string[] = [];
  for (const seg of combined.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      segments.pop();
    } else {
      segments.push(seg);
    }
  }
  return "/" + segments.join("/");
}

export function simulateVirtualFsIsolation(initialFiles: Record<string, string> = {}): {
  read: (p: string) => string;
  write: (p: string, c: string) => void;
  exists: (p: string) => boolean;
  snapshot: () => Record<string, string>;
  reset: () => void;
} {
  const store = new Map<string, string>();
  for (const [k, v] of Object.entries(initialFiles)) {
    store.set(sanitizeVirtualPath(k), v);
  }

  return {
    read(p: string): string {
      const target = sanitizeVirtualPath(p);
      const val = store.get(target);
      if (val === undefined) throw new Error(`ENOENT: no such file or directory, open '${target}'`);
      return val;
    },
    write(p: string, c: string): void {
      store.set(sanitizeVirtualPath(p), c);
    },
    exists(p: string): boolean {
      return store.has(sanitizeVirtualPath(p));
    },
    snapshot(): Record<string, string> {
      const out: Record<string, string> = {};
      for (const [k, v] of store.entries()) out[k] = v;
      return out;
    },
    reset(): void {
      store.clear();
    },
  };
}

export function computeParetoSkew(durations: readonly number[]): ParetoSkewResult {
  if (durations.length === 0) {
    return { p50Count: 0, p90Count: 0, totalDurationMs: 0, isSkewed: false };
  }

  const clean = durations.map((d) => (Number.isNaN(d) ? 0 : Math.max(0, d))).sort((a, b) => b - a);

  const total = clean.reduce((acc, curr) => acc + curr, 0);
  if (total <= 0) {
    return { p50Count: clean.length, p90Count: clean.length, totalDurationMs: 0, isSkewed: false };
  }

  let acc = 0;
  let p50Count = 0;
  let p90Count = 0;

  for (let i = 0; i < clean.length; i++) {
    acc += clean[i]!;
    if (p50Count === 0 && acc >= 0.5 * total) p50Count = i + 1;
    if (p90Count === 0 && acc >= 0.9 * total) p90Count = i + 1;
  }

  if (p50Count === 0) p50Count = clean.length;
  if (p90Count === 0) p90Count = clean.length;

  const isSkewed = p50Count <= Math.max(1, Math.floor(clean.length * 0.2));
  return {
    p50Count,
    p90Count,
    totalDurationMs: Math.round(total * 100) / 100,
    isSkewed,
  };
}

export function processTestStreamEvents(
  events: readonly TestStreamEvent[],
): StreamProcessingResult {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let totalDurationMs = 0;
  let minDurationMs: number | undefined;
  let maxDurationMs: number | undefined;

  for (const evt of events) {
    const rawDur = typeof evt.durationMs === "number" ? evt.durationMs : 0;
    const dur = Number.isNaN(rawDur) ? 0 : Math.max(0, rawDur);
    totalDurationMs += dur;
    minDurationMs = minDurationMs === undefined ? dur : Math.min(minDurationMs, dur);
    maxDurationMs = maxDurationMs === undefined ? dur : Math.max(maxDurationMs, dur);

    if (evt.status === "pass") {
      passed += 1;
    } else if (evt.status === "fail") {
      failed += 1;
    } else {
      skipped += 1;
    }
  }

  const total = events.length;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 100;
  const avgDurationMs = total > 0 ? Math.round((totalDurationMs / total) * 100) / 100 : 0;

  return {
    total,
    passed,
    failed,
    skipped,
    totalDurationMs: Math.round(totalDurationMs * 100) / 100,
    passRate,
    minDurationMs: minDurationMs ?? 0,
    maxDurationMs: maxDurationMs ?? 0,
    avgDurationMs,
  };
}

export function evaluateCoverageGate(breakdown: CoverageBreakdown): CoverageGateVerdict {
  const clamp = (val: number): number => {
    if (typeof val !== "number" || Number.isNaN(val)) return 0;
    return Math.max(0, Math.min(100, val));
  };

  const lines = clamp(breakdown.linesPercentage);
  const statements = clamp(breakdown.statementsPercentage);
  const functions = clamp(breakdown.functionsPercentage);
  const branches = clamp(breakdown.branchesPercentage);

  const averageCoverage = Math.round(((lines + statements + functions + branches) / 4) * 10) / 10;
  const meetsGate = averageCoverage >= MANDATORY_COVERAGE_THRESHOLD;
  const deficit = meetsGate
    ? 0
    : Math.round((MANDATORY_COVERAGE_THRESHOLD - averageCoverage) * 10) / 10;

  return {
    meetsGate,
    threshold: MANDATORY_COVERAGE_THRESHOLD,
    averageCoverage,
    breakdown: {
      linesPercentage: lines,
      statementsPercentage: statements,
      functionsPercentage: functions,
      branchesPercentage: branches,
    },
    deficit,
  };
}

export function renderHtml5CoverageDashboard(
  streamSummary: StreamProcessingResult,
  coverageVerdict: CoverageGateVerdict,
  options: ObsidianDashboardOptions = {},
): string {
  const statusColor = coverageVerdict.meetsGate ? "#22c55e" : "#ef4444";
  const title = escapeHtml(options.title ?? "Live Coverage Analytics Dashboard");
  const deepLink = options.activeDeepLink
    ? formatDeepLink(options.activeDeepLink, 42)
    : "#coverage/root:L1";
  const safeDeepLink = escapeHtml(deepLink);

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="UTF-8">',
    `<title>${title}</title>`,
    "<style>",
    ":root {",
    "  --bg-primary: #1e1e1e;",
    "  --bg-secondary: #252525;",
    "  --text-normal: #dcddde;",
    "  --text-accent: #a78bfa;",
    "  --interactive-accent: #7c3aed;",
    "  --border-color: #2e2e2e;",
    "}",
    "body { font-family: sans-serif; margin: 2rem; background: var(--bg-primary); color: var(--text-normal); }",
    ".card { background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; padding: 1.5rem; }",
    ".status { font-weight: bold; }",
    "a { color: var(--text-accent); text-decoration: none; }",
    "a:hover { text-decoration: underline; }",
    "</style>",
    "</head>",
    "<body>",
    `<h1>${title}</h1>`,
    `<div class="card" style="border-left: 4px solid ${statusColor};">`,
    `<p class="status">Status: ${coverageVerdict.meetsGate ? "GATE PASSED" : "GATE FAILED"}</p>`,
    `<p>Average Coverage: ${coverageVerdict.averageCoverage}% (Threshold: ${coverageVerdict.threshold}%)</p>`,
    `<p>Deficit: ${coverageVerdict.deficit}%</p>`,
    `<p>Tests: ${streamSummary.passed}/${streamSummary.total} passed (${streamSummary.totalDurationMs}ms)</p>`,
    `<p>Deep Link: <a id="deep-link" href="${safeDeepLink}">${safeDeepLink}</a></p>`,
    "</div>",
    "</body>",
    "</html>",
  ].join("\n");
}
