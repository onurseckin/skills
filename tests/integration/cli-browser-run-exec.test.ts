import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import type { BrowserRunRecord } from "../../orchestrating-long-tasks/scripts/src/reporting/browser-run-types.ts";
import { cleanupRoots } from "../unit/cli/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../unit/cli/file-persistence-fixture.ts";
import { readJsonFile } from "../unit/cli/visual-validation-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

function writeRunnerReport(repo: string): void {
  mkdirSync(join(repo, "test-results"), { recursive: true });
  writeFileSync(
    join(repo, "test-results", "report.json"),
    JSON.stringify({
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
          file: "tests/e2e/drawer.spec.ts",
          specs: [
            {
              tests: [
                { results: [{ attachments: [{ name: "trace", path: "test-results/trace.zip" }] }] },
              ],
            },
          ],
        },
      ],
    }),
    "utf-8",
  );
}

async function exec(run: string, repo: string, actor: string): Promise<Record<string, unknown>> {
  return execute([
    "run:exec",
    "--run",
    run,
    "--actor",
    actor,
    "--task",
    "task-core",
    "--gate",
    "gate-core",
    "--cwd",
    repo,
    "--",
    "echo",
    "browser-suite",
  ]);
}

describe("run:exec browser run capture", () => {
  test("records the run a validator's browser suite left behind", async () => {
    const { repo, run } = await setupCompiledRun("browser-exec", roots);
    writeRunnerReport(repo);

    const result = await exec(run, repo, "validator-1");
    const browserRun = result.browser_run as BrowserRunRecord | undefined;

    expect(browserRun?.command_id).toBe(String(result.command_id));
    expect(browserRun?.task_id).toBe("task-core");
    expect(browserRun?.actor).toBe("validator-1");
    expect(browserRun?.browser).toBe("chromium");
    expect(browserRun?.viewport).toEqual({ width: 1440, height: 900 });
    expect(browserRun?.test_file).toBe("tests/e2e/drawer.spec.ts");
    expect(browserRun?.traces).toEqual(["test-results/trace.zip"]);
    expect(browserRun?.status).toBe("passed");
    expect(typeof browserRun?.duration_ms).toBe("number");
    expect(browserRun?.evidence_classes.duration_ms).toBe("harness_observed");
    expect(browserRun?.evidence_classes.viewport).toBe("agent_reported");

    // A browser run is something a command did, so it is stored in that command's directory.
    const stored = readJsonFile<BrowserRunRecord>(
      join(run, "commands", String(result.command_id), "browser-run.json"),
    );
    expect(stored.browser).toBe("chromium");
  });

  test("records no browser run for a command that left no report", async () => {
    const { repo, run } = await setupCompiledRun("browser-exec-none", roots);

    const result = await exec(run, repo, "validator-1");

    expect(result.browser_run).toBeUndefined();
    expect(existsSync(join(run, "commands", String(result.command_id), "browser-run.json"))).toBe(
      false,
    );
  });

  test("a report an earlier suite left in the repository belongs to no later command", async () => {
    const { repo, run } = await setupCompiledRun("browser-exec-stale", roots);
    writeRunnerReport(repo);
    const stale = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(join(repo, "test-results", "report.json"), stale, stale);

    const result = await exec(run, repo, "worker-1");

    expect(result.browser_run).toBeUndefined();
    expect(existsSync(join(run, "commands", String(result.command_id), "browser-run.json"))).toBe(
      false,
    );
  });
});
