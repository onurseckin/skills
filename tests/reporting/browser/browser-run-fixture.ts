import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingestBrowserRun } from "../../../olt/scripts/src/reporting/browser-run-ingestion.ts";
import type { BrowserRunRecord } from "../../../olt/scripts/src/reporting/browser-run-types.ts";

type IngestOverrides = Partial<Parameters<typeof ingestBrowserRun>[0]>;

/** One simulated command's window, opened when the test body asks for it. */
export interface BrowserRunHarness {
  readonly startedMs: number;
  /** Stamps a report as an earlier run's leftover: last written before this command even started. */
  stampBeforeStart(path: string, millisecondsBefore: number): void;
  /** Stamps a report as a later run's, written after this command had already returned. */
  stampAfterFinish(path: string, millisecondsAfter: number): void;
  ingest(runRoot: string, repo: string, overrides?: IngestOverrides): BrowserRunRecord | null;
}

const roots: string[] = [];

export function tempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `browser-run-${name}-`));
  roots.push(dir);
  return dir;
}

export function cleanupTempDirs(): void {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
}

export function writeReport(dir: string, name: string, body: unknown): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(body), "utf-8");
  return path;
}

function stamp(path: string, at: number): void {
  const when = new Date(at);
  utimesSync(path, when, when);
}

/**
 * Opens the command window at the moment the test body asks for it, so call it there and not at
 * module scope. Ingestion accepts a report only when its mtime falls inside the window, and these
 * fixtures write their reports with the real clock — no file can be written in a fixed past. A
 * window opened once at module load therefore stops describing reality the moment a body runs later
 * than the import, which is precisely what a parallel run does to every test but the first.
 */
export function browserRunHarness(): BrowserRunHarness {
  const startedMs = Date.now();
  const finishedMs = startedMs + 1500;
  const startedAt = new Date(startedMs).toISOString();
  const finishedAt = new Date(finishedMs).toISOString();
  return {
    startedMs,
    stampBeforeStart(path, millisecondsBefore) {
      stamp(path, startedMs - millisecondsBefore);
    },
    stampAfterFinish(path, millisecondsAfter) {
      stamp(path, finishedMs + millisecondsAfter);
    },
    ingest(runRoot, repo, overrides = {}) {
      return ingestBrowserRun({
        runRoot,
        commandId: "C-1",
        taskId: "T-1",
        actor: "validator-1",
        searchDirs: [repo],
        startedAt,
        finishedAt,
        exitCode: 0,
        ...overrides,
      });
    },
  };
}

export function runnerReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    config: {
      projects: [
        {
          name: "chromium",
          use: { browserName: "chromium", viewport: { width: 1440, height: 900 } },
        },
      ],
    },
    suites: [
      {
        file: "tests/browser/login.spec.ts",
        specs: [
          {
            tests: [
              {
                results: [
                  {
                    attachments: [
                      { name: "trace", path: "/artifacts/trace.zip" },
                      { name: "video", path: "/artifacts/session.webm" },
                      { name: "screenshot", path: "/artifacts/shot.png" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}
