import { ingestBrowserRun } from "../../../olt/scripts/src/reporting/browser-run-ingestion.ts";
import type { BrowserRunRecord } from "../../../olt/scripts/src/reporting/browser-run-types.ts";
import {
  cleanupVirtualBrowserFS,
  cleanupTempDirs,
  setVirtualMtime,
  setupVirtualBrowserFS,
  tempDir,
} from "./browser-virtual-fs.ts";

export { cleanupVirtualBrowserFS, cleanupTempDirs, setupVirtualBrowserFS, tempDir };

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

export function writeReport(dir: string, name: string, body: unknown): string {
  const vfs = setupVirtualBrowserFS();
  vfs.mkdirSync(dir, { recursive: true });
  const path = `${dir}/${name}`;
  vfs.writeFileSync(path, JSON.stringify(body));
  return path;
}

function stamp(path: string, at: number): void {
  setVirtualMtime(path, at);
}

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
