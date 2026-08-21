import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { RunFiles, RunState } from "../../../orchestrating-long-tasks/scripts/src/contracts/capsule.ts";
import {
  generateSummarySuite,
  loadCommandsFromDir,
} from "../../../orchestrating-long-tasks/scripts/src/summary/generate-summary.ts";
import { makeCommand, makeEvent, makeState, makeTask } from "./graph-fixtures.ts";
import { manifest } from "./markdown-fixtures.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(prefix = "generate-summary-"): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

/** A capsule read entirely in memory: `readRun` never touches disk, only the runRoot the
 * suite writes into (and the commands directory it walks) does. */
function fakeRunFiles(runRoot: string, overrides: Partial<RunFiles> = {}): RunFiles {
  const state = makeState([makeTask("T-1", { status: "done" })]) as unknown as RunState;
  return {
    runRoot,
    manifest: { ...manifest, run_id: "run-alpha" },
    prompt: new TextEncoder().encode("Build the search feature."),
    state,
    events: [makeEvent("task:done", 1, "2026-08-14T20:00:00.000Z", "worker-1", { task_id: "T-1" })],
    ...overrides,
  };
}

describe("generateSummarySuite", () => {
  test("writes timeline, metrics, graph and markdown to <runRoot>/summary matching the returned suite", () => {
    const runRoot = tempRoot();
    const loaded = fakeRunFiles(runRoot);

    const suite = generateSummarySuite({ capsulePath: "unused-when-readRun-is-injected" }, () => loaded);

    const summaryDir = join(runRoot, "summary");
    expect(existsSync(summaryDir)).toBe(true);
    expect(JSON.parse(readFileSync(join(summaryDir, "timeline.json"), "utf-8"))).toEqual(
      suite.timeline,
    );
    expect(JSON.parse(readFileSync(join(summaryDir, "metrics.json"), "utf-8"))).toEqual(
      suite.metrics,
    );
    expect(JSON.parse(readFileSync(join(summaryDir, "graph.json"), "utf-8"))).toEqual(suite.graph);
    expect(readFileSync(join(summaryDir, "summary.md"), "utf-8")).toBe(suite.markdown);
  });

  test("threads the decoded prompt bytes into the generated markdown", () => {
    const runRoot = tempRoot();
    const loaded = fakeRunFiles(runRoot, {
      prompt: new TextEncoder().encode("Ship the billing export."),
    });

    const suite = generateSummarySuite({ capsulePath: "x", writeToDisk: false }, () => loaded);

    expect(suite.markdown).toContain("Ship the billing export.");
  });

  test("writeToDisk: false returns the suite without creating a summary directory", () => {
    const runRoot = tempRoot();
    const loaded = fakeRunFiles(runRoot);

    const suite = generateSummarySuite({ capsulePath: "x", writeToDisk: false }, () => loaded);

    expect(existsSync(join(runRoot, "summary"))).toBe(false);
    expect(suite.timeline.length).toBeGreaterThan(0);
    expect(typeof suite.markdown).toBe("string");
  });

  test("an outDir also gets the graph dataset, named by the run id, creating the dir if missing", () => {
    const runRoot = tempRoot();
    const outDir = join(tempRoot(), "exports", "nested");
    const loaded = fakeRunFiles(runRoot);

    const suite = generateSummarySuite({ capsulePath: "x", outDir }, () => loaded);

    expect(existsSync(outDir)).toBe(true);
    expect(JSON.parse(readFileSync(join(outDir, "run-alpha.json"), "utf-8"))).toEqual(suite.graph);
  });

  test("reuses an outDir that already exists instead of failing on mkdir", () => {
    const runRoot = tempRoot();
    const outDir = tempRoot("generate-summary-out-");
    const loaded = fakeRunFiles(runRoot);

    generateSummarySuite({ capsulePath: "x", outDir }, () => loaded);

    expect(existsSync(join(outDir, "run-alpha.json"))).toBe(true);
  });

  test("falls back to the run root's own directory name when the manifest carries no run id", () => {
    const runRoot = tempRoot();
    const outDir = join(tempRoot(), "exports");
    const loaded = fakeRunFiles(runRoot, { manifest: { ...manifest, run_id: "" } });

    generateSummarySuite({ capsulePath: "x", outDir }, () => loaded);

    expect(existsSync(join(outDir, `${basename(runRoot)}.json`))).toBe(true);
  });

  test("reads command records already on disk under <runRoot>/commands and counts them", () => {
    const runRoot = tempRoot();
    const commandDir = join(runRoot, "commands", "C-1");
    mkdirSync(commandDir, { recursive: true });
    writeFileSync(
      join(commandDir, "record.json"),
      JSON.stringify(makeCommand("C-1", { task_id: "T-1" })),
      "utf-8",
    );
    const loaded = fakeRunFiles(runRoot);

    const suite = generateSummarySuite({ capsulePath: "x", writeToDisk: false }, () => loaded);

    expect(suite.metrics.total_commands_executed).toBe(1);
  });
});

describe("loadCommandsFromDir", () => {
  test("returns no commands when the directory does not exist", () => {
    const runRoot = tempRoot();
    expect(loadCommandsFromDir(join(runRoot, "commands"))).toEqual({});
  });

  test("returns no commands for an empty directory", () => {
    const runRoot = tempRoot();
    const dir = join(runRoot, "commands");
    mkdirSync(dir, { recursive: true });
    expect(loadCommandsFromDir(dir)).toEqual({});
  });

  test("ignores a file that sits directly in the commands directory", () => {
    const runRoot = tempRoot();
    const dir = join(runRoot, "commands");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "stray.json"), "{}", "utf-8");
    expect(loadCommandsFromDir(dir)).toEqual({});
  });

  test("ignores a command subdirectory that has no record.json", () => {
    const runRoot = tempRoot();
    const dir = join(runRoot, "commands");
    mkdirSync(join(dir, "C-empty"), { recursive: true });
    expect(loadCommandsFromDir(dir)).toEqual({});
  });

  test("swallows a record.json that is not valid JSON instead of throwing", () => {
    const runRoot = tempRoot();
    const dir = join(runRoot, "commands");
    mkdirSync(join(dir, "C-bad"), { recursive: true });
    writeFileSync(join(dir, "C-bad", "record.json"), "{not json", "utf-8");
    expect(loadCommandsFromDir(dir)).toEqual({});
  });

  test("skips a record.json whose id is missing or empty", () => {
    const runRoot = tempRoot();
    const dir = join(runRoot, "commands");
    mkdirSync(join(dir, "C-noid"), { recursive: true });
    writeFileSync(
      join(dir, "C-noid", "record.json"),
      JSON.stringify({ ...makeCommand("C-noid"), id: "" }),
      "utf-8",
    );
    expect(loadCommandsFromDir(dir)).toEqual({});
  });

  test("keys each valid command record by its own id, across multiple subdirectories", () => {
    const runRoot = tempRoot();
    const dir = join(runRoot, "commands");
    mkdirSync(join(dir, "C-1"), { recursive: true });
    mkdirSync(join(dir, "C-2"), { recursive: true });
    writeFileSync(join(dir, "C-1", "record.json"), JSON.stringify(makeCommand("C-1")), "utf-8");
    writeFileSync(join(dir, "C-2", "record.json"), JSON.stringify(makeCommand("C-2")), "utf-8");

    const commands = loadCommandsFromDir(dir);

    expect(Object.keys(commands).sort()).toEqual(["C-1", "C-2"]);
    expect(commands["C-1"]?.id).toBe("C-1");
    expect(commands["C-2"]?.id).toBe("C-2");
  });
});
