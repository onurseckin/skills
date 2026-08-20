import { readFileSync, statSync } from "node:fs";
import type { CategoryExtras } from "../contracts/taxonomy.ts";
import type { BrowserRunViewport, NamedBrowserRunViewport } from "./browser-run-types.ts";

/** A report larger than this is not read at all; a truncated parse would invent a shape. */
export const MAX_BROWSER_REPORT_BYTES = 8 * 1024 * 1024;

/**
 * What a runner said about its own execution. Every field is what the report file declared — the
 * harness measured none of it, so a caller must label all of it as reported rather than observed.
 */
export interface BrowserReportFacts {
  sourcePath: string;
  /** Top-level scalars the generic fields have no home for, under the names the report used. */
  extras?: CategoryExtras | undefined;
  runner?: string | undefined;
  testFile?: string | undefined;
  browser?: string | undefined;
  status?: string | undefined;
  viewport?: BrowserRunViewport | undefined;
  viewports?: NamedBrowserRunViewport[] | undefined;
  traces?: string[] | undefined;
  videos?: string[] | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function viewportOf(value: unknown): BrowserRunViewport | undefined {
  if (!isRecord(value)) return undefined;
  const { width, height } = value;
  if (typeof width !== "number" || typeof height !== "number") return undefined;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
  return { width, height };
}

/** The single value the whole report agreed on, or nothing: picking one of several would be a guess. */
function unanimous(values: readonly string[]): string | undefined {
  const distinct = Array.from(new Set(values));
  return distinct.length === 1 ? distinct[0] : undefined;
}

/**
 * One viewport when the run used exactly one, otherwise the named list. A run that exercised three
 * viewports has no single viewport, and naming one of them would misreport the other two.
 */
function splitViewports(named: readonly NamedBrowserRunViewport[]): {
  viewport?: BrowserRunViewport | undefined;
  viewports?: NamedBrowserRunViewport[] | undefined;
} {
  const distinct = new Map<string, NamedBrowserRunViewport>();
  for (const entry of named) distinct.set(`${entry.width}x${entry.height}`, entry);
  if (distinct.size === 0) return {};
  if (distinct.size === 1) {
    const only = Array.from(distinct.values())[0];
    return only ? { viewport: { width: only.width, height: only.height } } : {};
  }
  return { viewports: [...named] };
}

function collectAttachments(node: unknown, traces: string[], videos: string[], depth = 0): void {
  if (depth > 12) return;
  if (Array.isArray(node)) {
    for (const entry of node) collectAttachments(entry, traces, videos, depth + 1);
    return;
  }
  if (!isRecord(node)) return;

  const attachments = node.attachments;
  if (Array.isArray(attachments)) {
    for (const attachment of attachments) {
      if (!isRecord(attachment)) continue;
      const path = text(attachment, "path");
      const name = text(attachment, "name");
      if (!path) continue;
      if (name === "trace") traces.push(path);
      else if (name === "video") videos.push(path);
    }
  }
  for (const key of ["suites", "specs", "tests", "results"]) {
    collectAttachments(node[key], traces, videos, depth + 1);
  }
}

function collectSuiteFiles(node: unknown, files: string[], depth = 0): void {
  if (depth > 12) return;
  if (Array.isArray(node)) {
    for (const entry of node) collectSuiteFiles(entry, files, depth + 1);
    return;
  }
  if (!isRecord(node)) return;
  const file = text(node, "file");
  if (file) files.push(file);
  collectSuiteFiles(node.suites, files, depth + 1);
  collectSuiteFiles(node.specs, files, depth + 1);
}

function projectFacts(config: unknown): {
  browser?: string | undefined;
  named: NamedBrowserRunViewport[];
} {
  const named: NamedBrowserRunViewport[] = [];
  if (!isRecord(config) || !Array.isArray(config.projects)) return { named };
  const browsers: string[] = [];
  for (const project of config.projects) {
    if (!isRecord(project)) continue;
    const use = isRecord(project.use) ? project.use : undefined;
    const browser = use ? text(use, "browserName") : undefined;
    if (browser) browsers.push(browser);
    const viewport = use ? viewportOf(use.viewport) : undefined;
    if (viewport) {
      // Every field here is what the report declared (see file header); "project" would read as
      // a real name the config gave when neither project.name nor a browser name were present.
      named.push({ ...viewport, name: text(project, "name") ?? browser ?? "unknown" });
    }
  }
  const browser = unanimous(browsers);
  return { ...(browser === undefined ? {} : { browser }), named };
}

/**
 * A report whose shape matches the runner JSON convention: a `suites` array plus the config that
 * produced it. The shape is what identifies it — the file's own name proves nothing about the tool.
 */
function runnerReportFacts(
  parsed: Record<string, unknown>,
  sourcePath: string,
): BrowserReportFacts {
  const { browser, named } = projectFacts(parsed.config);
  const files: string[] = [];
  collectSuiteFiles(parsed.suites, files);
  const traces: string[] = [];
  const videos: string[] = [];
  collectAttachments(parsed.suites, traces, videos);
  const testFile = unanimous(files);
  const runner = text(parsed, "runner");
  const status = text(parsed, "status");

  const extras = reportExtras(parsed);
  return {
    sourcePath,
    ...(extras === undefined ? {} : { extras }),
    ...(runner === undefined ? {} : { runner }),
    ...(testFile === undefined ? {} : { testFile }),
    ...(browser === undefined ? {} : { browser }),
    ...(status === undefined ? {} : { status }),
    ...splitViewports(named),
    ...(traces.length > 0 ? { traces: Array.from(new Set(traces)) } : {}),
    ...(videos.length > 0 ? { videos: Array.from(new Set(videos)) } : {}),
  };
}

/**
 * The visual metrics report the repository's own visual suite writes: named viewports, and a
 * metadata block where a runner may name itself, the browser it drove and the file it ran.
 */
function visualReportFacts(
  parsed: Record<string, unknown>,
  sourcePath: string,
): BrowserReportFacts {
  const viewports = isRecord(parsed.viewports) ? parsed.viewports : {};
  const named: NamedBrowserRunViewport[] = [];
  for (const [name, value] of Object.entries(viewports)) {
    const viewport = viewportOf(value);
    if (viewport) named.push({ ...viewport, name });
  }
  const metadata = isRecord(parsed.metadata) ? parsed.metadata : {};
  const runner = text(metadata, "runner");
  const browser = text(metadata, "browser");
  const testFile = text(metadata, "testFile");
  const status = text(metadata, "status");

  const extras = reportExtras(parsed);
  return {
    sourcePath,
    ...(extras === undefined ? {} : { extras }),
    ...(runner === undefined ? {} : { runner }),
    ...(testFile === undefined ? {} : { testFile }),
    ...(browser === undefined ? {} : { browser }),
    ...(status === undefined ? {} : { status }),
    ...splitViewports(named),
  };
}

/** The generic fields a report is read into; anything else it declared is an extra. */
const MAPPED_REPORT_KEYS: ReadonlySet<string> = new Set([
  "runner",
  "status",
  "browser",
  "testFile",
  "config",
  "suites",
  "specs",
  "tests",
  "results",
  "attachments",
  "errors",
  "viewports",
  "metadata",
]);

/** An extras bag stays small enough that a report cannot bloat the capsule through it. */
const MAX_REPORT_EXTRAS = 32;

/**
 * Whatever else the report declared at its top level, kept verbatim under its own name. Only
 * scalars are taken: a nested structure belongs to a shape this reader does not claim to
 * understand, and copying it would assert a meaning nobody reported.
 */
function reportExtras(parsed: Record<string, unknown>): CategoryExtras | undefined {
  const extras: CategoryExtras = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (MAPPED_REPORT_KEYS.has(key)) continue;
    if (Object.keys(extras).length >= MAX_REPORT_EXTRAS) break;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      extras[key] = value;
    }
  }
  return Object.keys(extras).length > 0 ? extras : undefined;
}

function hasFacts(facts: BrowserReportFacts): boolean {
  return Object.keys(facts).some((key) => key !== "sourcePath" && key !== "extras");
}

/**
 * Reads one candidate report. Returns nothing when the file cannot be read, does not parse, is not
 * a shape this understands, or carried no fact at all — an empty record would assert a browser run
 * the harness has no evidence of.
 */
export function readBrowserRunReport(path: string): BrowserReportFacts | undefined {
  let raw: string;
  try {
    if (statSync(path).size > MAX_BROWSER_REPORT_BYTES) return undefined;
    raw = readFileSync(path, "utf-8");
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;

  const facts = Array.isArray(parsed.suites)
    ? runnerReportFacts(parsed, path)
    : isRecord(parsed.viewports)
      ? visualReportFacts(parsed, path)
      : undefined;
  if (!facts || !hasFacts(facts)) return undefined;
  return facts;
}
